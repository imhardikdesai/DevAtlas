import { promises as fs } from 'node:fs';
import path from 'node:path';

import { SKIPPED_DIRECTORIES, isContained, toRelativePath } from '@/lib/config/paths';
import { errnoCode } from '@/lib/errors';
import { resolveRepositoryRoot, repositoryName } from '@/lib/git/repository';

/** How deep below the workspace root discovery will descend. */
export const MAX_DISCOVERY_DEPTH = 8;

export interface DiscoveredRepository {
  absolutePath: string;
  relativePath: string;
  name: string;
}

export interface DiscoveryWarning {
  path: string;
  reason: string;
}

export interface DiscoveryResult {
  repositories: DiscoveredRepository[];
  warnings: DiscoveryWarning[];
  /** True when the traversal stopped early because of the depth cap. */
  truncated: boolean;
}

interface WalkState {
  root: string;
  visited: Set<string>;
  candidates: string[];
  warnings: DiscoveryWarning[];
  truncated: boolean;
}

/**
 * Discover every independent Git repository inside `root`.
 *
 * Strategy: walk the tree collecting directories that contain a `.git` entry
 * (directory *or* file — a file is how linked worktrees and submodules record
 * their git dir), then ask Git to confirm each candidate is a work-tree root.
 * Confirmation is what makes the result correct: a directory inside a
 * repository reports its parent as the top level and is therefore rejected,
 * and deduplicating on the canonical top level makes duplicates impossible.
 *
 * The walk continues *into* repositories, because a checkout nested inside
 * another repository is still an independent repository the user cares about.
 */
export async function discoverRepositories(root: string): Promise<DiscoveryResult> {
  const realRoot = await fs.realpath(root);

  const state: WalkState = {
    root: realRoot,
    visited: new Set<string>(),
    candidates: [],
    warnings: [],
    truncated: false,
  };

  await walk(realRoot, 0, state);

  // Validate candidates with Git, in parallel but bounded.
  const confirmed = new Map<string, DiscoveredRepository>();
  const validated = await mapWithConcurrency(state.candidates, 8, async (dir) => ({
    dir,
    toplevel: await resolveRepositoryRoot(dir),
  }));

  for (const { dir, toplevel } of validated) {
    if (!toplevel) {
      state.warnings.push({ path: dir, reason: 'Contains .git but is not a git repository root' });
      continue;
    }
    if (!isContained(toplevel, realRoot)) continue;
    if (confirmed.has(toplevel)) continue;

    const relativePath = toRelativePath(realRoot, toplevel);
    confirmed.set(toplevel, {
      absolutePath: toplevel,
      relativePath,
      name: relativePath === '.' ? repositoryName(toplevel) : path.basename(toplevel),
    });
  }

  const repositories = [...confirmed.values()].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );

  return { repositories, warnings: state.warnings, truncated: state.truncated };
}

async function walk(dir: string, depth: number, state: WalkState): Promise<void> {
  if (state.visited.has(dir)) return;
  state.visited.add(dir);

  if (depth > MAX_DISCOVERY_DEPTH) {
    state.truncated = true;
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    // One unreadable directory must never abort the whole discovery.
    state.warnings.push({ path: dir, reason: `Could not read directory (${errnoCode(error)})` });
    return;
  }

  const hasGitEntry = entries.some((entry) => entry.name === '.git');
  if (hasGitEntry) state.candidates.push(dir);

  const subdirectories: string[] = [];

  for (const entry of entries) {
    if (entry.name === '.git') continue;
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;

    const child = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      subdirectories.push(child);
      continue;
    }

    if (entry.isSymbolicLink()) {
      // Follow a symlinked directory only when its target stays inside the
      // workspace, and only once — the visited set breaks cycles.
      let real: string;
      try {
        real = await fs.realpath(child);
      } catch {
        continue;
      }
      if (!isContained(real, state.root)) continue;
      let stats;
      try {
        stats = await fs.stat(real);
      } catch {
        continue;
      }
      if (stats.isDirectory()) subdirectories.push(real);
    }
  }

  for (const child of subdirectories) {
    let real: string;
    try {
      real = await fs.realpath(child);
    } catch (error) {
      const code = errnoCode(error);
      if (code !== 'ENOENT') {
        state.warnings.push({ path: child, reason: `Could not resolve path (${code})` });
      }
      continue;
    }
    if (!isContained(real, state.root)) continue;
    await walk(real, depth + 1, state);
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}
