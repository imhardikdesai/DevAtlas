import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  configPath,
  dataPath,
  devAtlasDir,
  runtimePath,
} from '@/lib/config/paths';
import { DevAtlasError, errnoCode } from '@/lib/errors';
import { atomicWriteFile, readFileIfExists, withFileLock } from '@/lib/persistence/atomic';
import {
  SCHEMA_VERSION,
  runtimeRecordSchema,
  workspaceConfigSchema,
  workspaceDataSchema,
} from '@/lib/validation/schemas';
import type {
  GroupRecord,
  RepositoryRecord,
  RuntimeRecord,
  WorkspaceConfig,
  WorkspaceData,
} from '@/types';

/**
 * A repository's identity is derived from its workspace-relative path, so the
 * id stays stable across restarts and rediscovery for as long as the repository
 * stays where it is — which is what lets group assignments survive.
 */
export function repositoryId(relativePath: string): string {
  return createHash('sha256').update(relativePath).digest('hex').slice(0, 16);
}

export function newGroupId(): string {
  return randomUUID();
}

export function newWorkspaceId(): string {
  return randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/* -------------------------------------------------------------------------- */
/* config.json                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Read `.devatlas/config.json`.
 *
 * Returns undefined when the workspace has never been initialized. Throws
 * INVALID_CONFIG when the file exists but cannot be understood — the caller
 * reports that and stops. Nothing here ever rewrites, truncates or deletes an
 * existing file, so a malformed config is always recoverable by hand.
 */
export async function readConfig(root: string): Promise<WorkspaceConfig | undefined> {
  const file = configPath(root);
  const raw = await readFileIfExists(file);
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DevAtlasError('INVALID_CONFIG', `${file} is not valid JSON.`, {
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const result = workspaceConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new DevAtlasError('INVALID_CONFIG', `${file} does not match the expected format.`, {
      detail: formatZodIssues(result.error.issues),
    });
  }

  if (result.data.schemaVersion > SCHEMA_VERSION) {
    throw new DevAtlasError(
      'INVALID_CONFIG',
      `${file} was written by a newer version of DevAtlas (schema ${result.data.schemaVersion}).`,
    );
  }

  return result.data;
}

export async function writeConfig(root: string, config: WorkspaceConfig): Promise<void> {
  const file = configPath(root);
  await withFileLock(file, async () => {
    await atomicWriteFile(file, `${JSON.stringify(config, null, 2)}\n`);
  });
}

/* -------------------------------------------------------------------------- */
/* data.json                                                                  */
/* -------------------------------------------------------------------------- */

const EMPTY_DATA: WorkspaceData = { repositories: [], groups: [] };

/**
 * Read `.devatlas/data.json`. A missing file is normal (treated as empty); a
 * malformed one is an error rather than a reason to start over, so repository
 * and group metadata is never silently discarded.
 */
export async function readData(root: string): Promise<WorkspaceData> {
  const file = dataPath(root);
  const raw = await readFileIfExists(file);
  if (raw === undefined) return structuredClone(EMPTY_DATA);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new DevAtlasError('INVALID_CONFIG', `${file} is not valid JSON.`, {
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const result = workspaceDataSchema.safeParse(parsed);
  if (!result.success) {
    throw new DevAtlasError('INVALID_CONFIG', `${file} does not match the expected format.`, {
      detail: formatZodIssues(result.error.issues),
    });
  }
  return result.data;
}

export async function writeData(root: string, data: WorkspaceData): Promise<void> {
  const file = dataPath(root);
  await withFileLock(file, async () => {
    await atomicWriteFile(file, `${JSON.stringify({ ...data, updatedAt: nowIso() }, null, 2)}\n`);
  });
}

/**
 * Read-modify-write `data.json` under a lock, so two concurrent API requests
 * cannot clobber each other's changes.
 */
export async function updateData<T>(
  root: string,
  mutate: (data: WorkspaceData) => Promise<{ data: WorkspaceData; result: T }> | { data: WorkspaceData; result: T },
): Promise<T> {
  const file = dataPath(root);
  return withFileLock(file, async () => {
    const current = await readData(root);
    const { data, result } = await mutate(current);
    await atomicWriteFile(file, `${JSON.stringify({ ...data, updatedAt: nowIso() }, null, 2)}\n`);
    return result;
  });
}

/* -------------------------------------------------------------------------- */
/* runtime.json                                                               */
/* -------------------------------------------------------------------------- */

export async function readRuntime(root: string): Promise<RuntimeRecord | undefined> {
  const raw = await readFileIfExists(runtimePath(root));
  if (raw === undefined) return undefined;
  try {
    const result = runtimeRecordSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export async function writeRuntime(root: string, record: RuntimeRecord): Promise<void> {
  await atomicWriteFile(runtimePath(root), `${JSON.stringify(record, null, 2)}\n`);
}

export async function clearRuntime(root: string): Promise<void> {
  await fs.rm(runtimePath(root), { force: true }).catch(() => undefined);
}

/* -------------------------------------------------------------------------- */
/* Initialization                                                             */
/* -------------------------------------------------------------------------- */

export interface EnsureWorkspaceResult {
  config: WorkspaceConfig;
  created: boolean;
}

/**
 * Create `.devatlas/config.json` if absent, otherwise return the existing one
 * untouched.
 *
 * Re-running `init` on an initialized workspace must preserve the workspace
 * name, its stable id and all group assignments (spec §5.4), so the existing
 * config is returned verbatim; only `rootPath` is corrected if the workspace
 * directory was moved, which cannot lose user data.
 */
export async function ensureWorkspace(root: string): Promise<EnsureWorkspaceResult> {
  const existing = await readConfig(root);

  if (existing) {
    if (existing.rootPath !== root) {
      await writeConfig(root, { ...existing, rootPath: root, updatedAt: nowIso() });
      return { config: { ...existing, rootPath: root }, created: false };
    }
    return { config: existing, created: false };
  }

  await fs.mkdir(devAtlasDir(root), { recursive: true });

  const config: WorkspaceConfig = {
    schemaVersion: SCHEMA_VERSION,
    workspaceId: newWorkspaceId(),
    name: path.basename(root) || root,
    rootPath: root,
    createdAt: nowIso(),
  };
  await writeConfig(root, config);
  return { config, created: true };
}

/** Rename the workspace. Only the stored display name changes — never the directory. */
export async function renameWorkspace(root: string, name: string): Promise<WorkspaceConfig> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new DevAtlasError('INVALID_INPUT', 'Workspace name cannot be empty.');
  }

  const file = configPath(root);
  return withFileLock(file, async () => {
    const config = await readConfig(root);
    if (!config) {
      throw new DevAtlasError('NOT_INITIALIZED', 'This directory is not a DevAtlas workspace.');
    }
    const updated: WorkspaceConfig = { ...config, name: trimmed, updatedAt: nowIso() };
    await atomicWriteFile(file, `${JSON.stringify(updated, null, 2)}\n`);
    return updated;
  });
}

/* -------------------------------------------------------------------------- */
/* Merging discovery results                                                  */
/* -------------------------------------------------------------------------- */

export interface MergeInput {
  relativePath: string;
  absolutePath: string;
  name: string;
}

export interface MergeOutcome {
  repositories: RepositoryRecord[];
  groups: GroupRecord[];
  added: number;
  removed: number;
  total: number;
}

/**
 * Fold a discovery result into stored metadata.
 *
 * Existing repositories keep their id and therefore their group membership.
 * Repositories that were not found are kept with `available: false` rather than
 * deleted, so a repository that is temporarily unavailable — an unmounted
 * volume, a directory being moved — does not lose its group assignment.
 */
export function mergeRepositories(
  existing: WorkspaceData,
  discovered: readonly MergeInput[],
): MergeOutcome {
  const byRelativePath = new Map(existing.repositories.map((r) => [r.relativePath, r]));
  const seen = new Set<string>();
  const timestamp = nowIso();

  const next: RepositoryRecord[] = [];
  let added = 0;

  for (const repo of discovered) {
    seen.add(repo.relativePath);
    const prior = byRelativePath.get(repo.relativePath);
    if (prior) {
      next.push({
        ...prior,
        name: repo.name,
        absolutePath: repo.absolutePath,
        available: true,
        lastSeenAt: timestamp,
      });
    } else {
      added += 1;
      next.push({
        id: repositoryId(repo.relativePath),
        name: repo.name,
        absolutePath: repo.absolutePath,
        relativePath: repo.relativePath,
        available: true,
        lastSeenAt: timestamp,
      });
    }
  }

  let removed = 0;
  for (const prior of existing.repositories) {
    if (seen.has(prior.relativePath)) continue;
    removed += 1;
    next.push({ ...prior, available: false });
  }

  next.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // Drop group references to repositories that no longer have a record at all.
  const validIds = new Set(next.map((r) => r.id));
  const groups = existing.groups.map((group) => ({
    ...group,
    repositoryIds: group.repositoryIds.filter((id) => validIds.has(id)),
  }));

  return { repositories: next, groups, added, removed, total: discovered.length };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatZodIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      return `${where}: ${issue.message}`;
    })
    .join('; ');
}

/** True when a process with this pid exists and we are allowed to signal it. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errnoCode(error) === 'EPERM';
  }
}
