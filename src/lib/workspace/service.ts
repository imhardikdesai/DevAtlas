import { assertContained } from '@/lib/config/paths';
import { discoverRepositories, mapWithConcurrency } from '@/lib/discovery/discover';
import { DevAtlasError } from '@/lib/errors';
import { isGitAvailable } from '@/lib/git/exec';
import {
  listBranches,
  probeRepository,
  readHead,
  readStatus,
  switchBranch,
} from '@/lib/git/repository';
import {
  mergeRepositories,
  newGroupId,
  readConfig,
  readData,
  updateData,
  writeData,
} from '@/lib/workspace/store';
import type {
  BranchInfo,
  BranchListing,
  GroupRecord,
  RepositoryRecord,
  RepositoryView,
  WorkspaceConfig,
  WorkspaceData,
  WorkspaceView,
} from '@/types';

/** Concurrent git status reads. Enough to be fast, few enough to be polite. */
const STATUS_CONCURRENCY = 8;
/** How long a status read may be reused before git is consulted again. */
const STATUS_TTL_MS = 3_000;

interface CacheEntry {
  at: number;
  view: Pick<RepositoryView, 'head' | 'status' | 'problem' | 'problemDetail'>;
}

const statusCache = new Map<string, CacheEntry>();

/**
 * Invalidate cached Git state. Called by the explicit Refresh action and
 * immediately after any branch switch, so the UI never shows a stale branch or
 * working-tree status as if it were current.
 */
export function invalidateStatusCache(repoPath?: string): void {
  if (repoPath) statusCache.delete(repoPath);
  else statusCache.clear();
}

export async function requireGit(): Promise<void> {
  if (!(await isGitAvailable())) {
    throw new DevAtlasError(
      'GIT_MISSING',
      'Git was not found on your PATH. Install Git and try again.',
    );
  }
}

export async function requireConfig(root: string): Promise<WorkspaceConfig> {
  const config = await readConfig(root);
  if (!config) {
    throw new DevAtlasError(
      'NOT_INITIALIZED',
      `${root} is not a DevAtlas workspace. Run \`devatlas init\` there first.`,
    );
  }
  return config;
}

export function toWorkspaceView(config: WorkspaceConfig, repositoryCount: number): WorkspaceView {
  return {
    workspaceId: config.workspaceId,
    name: config.name,
    rootPath: config.rootPath,
    createdAt: config.createdAt,
    repositoryCount,
  };
}

/* -------------------------------------------------------------------------- */
/* Repositories                                                               */
/* -------------------------------------------------------------------------- */

export function groupIdForRepository(data: WorkspaceData, repositoryId: string): string | null {
  const group = data.groups.find((g) => g.repositoryIds.includes(repositoryId));
  return group?.id ?? null;
}

/**
 * Read live Git state for one repository record.
 *
 * Every path is re-verified against the workspace root before git touches it,
 * so a record whose directory was replaced by a symlink pointing elsewhere is
 * rejected rather than followed.
 */
export async function readRepositoryState(
  root: string,
  record: RepositoryRecord,
  options: { force?: boolean } = {},
): Promise<Pick<RepositoryView, 'head' | 'status' | 'problem' | 'problemDetail'>> {
  const cached = statusCache.get(record.absolutePath);
  if (!options.force && cached && Date.now() - cached.at < STATUS_TTL_MS) {
    return cached.view;
  }

  let safePath: string;
  try {
    safePath = await assertContained(record.absolutePath, root);
  } catch (error) {
    const view = {
      head: null,
      status: null,
      problem:
        error instanceof DevAtlasError && error.code === 'PATH_ESCAPES_WORKSPACE'
          ? ('inaccessible' as const)
          : ('missing' as const),
      problemDetail: error instanceof Error ? error.message : String(error),
    };
    statusCache.set(record.absolutePath, { at: Date.now(), view });
    return view;
  }

  const probe = await probeRepository(safePath);
  if (!probe.ok) {
    const view = {
      head: null,
      status: null,
      problem: probe.problem,
      problemDetail: probe.detail,
    };
    statusCache.set(record.absolutePath, { at: Date.now(), view });
    return view;
  }

  try {
    const [head, status] = await Promise.all([readHead(safePath), readStatus(safePath)]);
    const view = { head, status, problem: undefined, problemDetail: undefined };
    statusCache.set(record.absolutePath, { at: Date.now(), view });
    return view;
  } catch (error) {
    const view = {
      head: null,
      status: null,
      problem: 'git-error' as const,
      problemDetail:
        error instanceof DevAtlasError ? (error.detail ?? error.message) : String(error),
    };
    statusCache.set(record.absolutePath, { at: Date.now(), view });
    return view;
  }
}

/** Join stored records with live Git state and group membership. */
export async function listRepositoryViews(
  root: string,
  data: WorkspaceData,
  options: { force?: boolean } = {},
): Promise<RepositoryView[]> {
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  const groupByRepo = new Map<string, GroupRecord>();
  for (const group of data.groups) {
    for (const id of group.repositoryIds) groupByRepo.set(id, group);
  }

  const states = await mapWithConcurrency(
    data.repositories,
    STATUS_CONCURRENCY,
    (record) => readRepositoryState(root, record, options),
  );

  return data.repositories.map((record, index) => {
    const group = groupByRepo.get(record.id);
    const state = states[index]!;
    return {
      id: record.id,
      name: record.name,
      absolutePath: record.absolutePath,
      relativePath: record.relativePath,
      available: record.available && !state.problem,
      groupId: group?.id ?? null,
      groupName: group ? (groupById.get(group.id)?.name ?? null) : null,
      ...state,
    };
  });
}

export function findRepository(data: WorkspaceData, id: string): RepositoryRecord {
  const record = data.repositories.find((r) => r.id === id);
  if (!record) {
    throw new DevAtlasError('REPOSITORY_NOT_FOUND', 'No such repository in this workspace.');
  }
  return record;
}

/** Re-run discovery and fold the result into stored metadata. */
export async function refreshRepositories(root: string): Promise<{
  data: WorkspaceData;
  added: number;
  removed: number;
  warnings: { path: string; reason: string }[];
}> {
  await requireGit();
  const discovery = await discoverRepositories(root);

  const data = await updateData(root, (current) => {
    const merged = mergeRepositories(current, discovery.repositories);
    return {
      data: { ...current, repositories: merged.repositories, groups: merged.groups },
      result: { merged },
    };
  });

  invalidateStatusCache();
  const fresh = await readData(root);

  return {
    data: fresh,
    added: data.merged.added,
    removed: data.merged.removed,
    warnings: discovery.warnings,
  };
}

/** First-time discovery during `init`, writing data.json. */
export async function initialDiscovery(root: string): Promise<{
  data: WorkspaceData;
  warnings: { path: string; reason: string }[];
}> {
  await requireGit();
  const discovery = await discoverRepositories(root);
  const current = await readData(root);
  const merged = mergeRepositories(current, discovery.repositories);
  const data: WorkspaceData = {
    ...current,
    repositories: merged.repositories,
    groups: merged.groups,
  };
  await writeData(root, data);
  return { data, warnings: discovery.warnings };
}

/* -------------------------------------------------------------------------- */
/* Branches                                                                   */
/* -------------------------------------------------------------------------- */

export async function readBranches(
  root: string,
  record: RepositoryRecord,
): Promise<BranchListing> {
  const safePath = await assertContained(record.absolutePath, root);
  const probe = await probeRepository(safePath);
  if (!probe.ok) {
    throw new DevAtlasError(
      'REPOSITORY_UNAVAILABLE',
      `${record.name} is not available: ${probe.detail ?? 'unknown reason'}`,
      { detail: probe.detail },
    );
  }
  return listBranches(safePath);
}

export interface SwitchRequest {
  branch: string;
  kind: 'local' | 'remote';
  confirmDirty: boolean;
}

export type SwitchResult =
  | { outcome: 'switched'; listing: BranchListing; status: Awaited<ReturnType<typeof readStatus>>; createdTrackingBranch?: string }
  | { outcome: 'needs-confirmation'; status: Awaited<ReturnType<typeof readStatus>> };

/**
 * Switch a repository to another branch, following spec §8.2 exactly.
 *
 * The ordering matters: the branch list and the working-tree status are both
 * re-read immediately before the operation, so a branch deleted or a file
 * modified since the page loaded is caught rather than acted on blindly.
 */
export async function performSwitch(
  root: string,
  record: RepositoryRecord,
  request: SwitchRequest,
): Promise<SwitchResult> {
  const safePath = await assertContained(record.absolutePath, root);

  const probe = await probeRepository(safePath);
  if (!probe.ok) {
    throw new DevAtlasError(
      'REPOSITORY_UNAVAILABLE',
      `${record.name} is not available: ${probe.detail ?? 'unknown reason'}`,
      { detail: probe.detail },
    );
  }

  // 2. Validate the target against the repository's *current* branch list.
  const listing = await listBranches(safePath);
  const pool: BranchInfo[] = request.kind === 'local' ? listing.local : listing.remote;
  const target = pool.find((b) => b.name === request.branch);
  if (!target) {
    throw new DevAtlasError(
      'BRANCH_NOT_FOUND',
      `Branch "${request.branch}" no longer exists in ${record.name}.`,
    );
  }
  if (target.current) {
    const status = await readStatus(safePath);
    return { outcome: 'switched', listing, status };
  }

  // 3 & 6. Re-check the working tree immediately before switching.
  const before = await readStatus(safePath);
  if (!before.clean && !request.confirmDirty) {
    return { outcome: 'needs-confirmation', status: before };
  }

  const result = await switchBranch(safePath, target);
  invalidateStatusCache(record.absolutePath);

  if (!result.ok) {
    // Git refused. The working tree is untouched; report git's own words.
    throw new DevAtlasError(
      'GIT_REFUSED',
      `Git did not switch ${record.name} to ${request.branch}. Your changes were left as they are.`,
      { detail: result.detail },
    );
  }

  const [afterListing, afterStatus] = await Promise.all([
    listBranches(safePath),
    readStatus(safePath),
  ]);

  return {
    outcome: 'switched',
    listing: afterListing,
    status: afterStatus,
    createdTrackingBranch: result.createdTrackingBranch,
  };
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                     */
/* -------------------------------------------------------------------------- */

function assertNameAvailable(groups: readonly GroupRecord[], name: string, exceptId?: string): void {
  const normalized = name.trim().toLocaleLowerCase();
  const clash = groups.some(
    (g) => g.id !== exceptId && g.name.trim().toLocaleLowerCase() === normalized,
  );
  if (clash) {
    throw new DevAtlasError('GROUP_NAME_TAKEN', `A group named "${name.trim()}" already exists.`);
  }
}

export async function createGroup(root: string, name: string): Promise<GroupRecord> {
  return updateData(root, (data) => {
    assertNameAvailable(data.groups, name);
    const group: GroupRecord = {
      id: newGroupId(),
      name: name.trim(),
      repositoryIds: [],
      createdAt: new Date().toISOString(),
    };
    return { data: { ...data, groups: [...data.groups, group] }, result: group };
  });
}

export async function renameGroup(root: string, id: string, name: string): Promise<GroupRecord> {
  return updateData(root, (data) => {
    const existing = data.groups.find((g) => g.id === id);
    if (!existing) throw new DevAtlasError('GROUP_NOT_FOUND', 'No such group.');
    assertNameAvailable(data.groups, name, id);

    const updated: GroupRecord = { ...existing, name: name.trim() };
    return {
      data: { ...data, groups: data.groups.map((g) => (g.id === id ? updated : g)) },
      result: updated,
    };
  });
}

/**
 * Delete a group. Its repositories fall back to Ungrouped — no repository
 * record, and certainly no file on disk, is ever removed.
 */
export async function deleteGroup(root: string, id: string): Promise<{ released: number }> {
  return updateData(root, (data) => {
    const existing = data.groups.find((g) => g.id === id);
    if (!existing) throw new DevAtlasError('GROUP_NOT_FOUND', 'No such group.');
    return {
      data: { ...data, groups: data.groups.filter((g) => g.id !== id) },
      result: { released: existing.repositoryIds.length },
    };
  });
}

/**
 * Assign a repository to a group, or to Ungrouped when `groupId` is null.
 * A repository belongs to at most one group in V1, enforced by removing it
 * from every other group first.
 */
export async function assignRepository(
  root: string,
  repoId: string,
  groupId: string | null,
): Promise<WorkspaceData> {
  return updateData(root, (data) => {
    findRepository(data, repoId);
    if (groupId !== null && !data.groups.some((g) => g.id === groupId)) {
      throw new DevAtlasError('GROUP_NOT_FOUND', 'No such group.');
    }

    const groups = data.groups.map((group) => {
      const without = group.repositoryIds.filter((id) => id !== repoId);
      if (group.id === groupId) return { ...group, repositoryIds: [...without, repoId] };
      return { ...group, repositoryIds: without };
    });

    const next = { ...data, groups };
    return { data: next, result: next };
  });
}
