import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DevAtlasError, errnoCode } from '@/lib/errors';
import { runGitIn } from '@/lib/git/exec';
import { BRANCH_FORMAT, parseBranchListing, parsePorcelainStatus } from '@/lib/git/parse';
import type {
  BranchInfo,
  BranchListing,
  HeadState,
  RepositoryProblem,
  WorkingTreeStatus,
} from '@/types';

/**
 * Ask Git whether `dir` is the top level of a work tree.
 *
 * Validating with Git rather than trusting the presence of a `.git` entry is
 * what keeps a subdirectory of a repository — or a stale `.git` file — from
 * being reported as an independent repository.
 *
 * Returns the canonical top-level path, or undefined when `dir` is not itself a
 * repository root.
 */
export async function resolveRepositoryRoot(dir: string): Promise<string | undefined> {
  const result = await runGitIn(dir, ['rev-parse', '--show-toplevel']);
  if (!result.ok) return undefined;

  const toplevel = result.stdout.trim();
  if (!toplevel) return undefined;

  try {
    const [realToplevel, realDir] = await Promise.all([fs.realpath(toplevel), fs.realpath(dir)]);
    return realToplevel === realDir ? realToplevel : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determine the current HEAD. Covers the three states the spec calls out:
 * a normal branch, a detached HEAD, and a repository with no commits yet
 * (an "unborn" branch, where HEAD names a ref that does not exist).
 */
export async function readHead(repoPath: string): Promise<HeadState> {
  const symbolic = await runGitIn(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);

  if (symbolic.ok) {
    const branch = symbolic.stdout.trim();
    const verify = await runGitIn(repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return verify.ok && verify.stdout.trim()
      ? { kind: 'branch', branch }
      : { kind: 'unborn', branch };
  }

  const detached = await runGitIn(repoPath, ['rev-parse', '--short', 'HEAD']);
  if (detached.ok && detached.stdout.trim()) {
    return { kind: 'detached', commit: detached.stdout.trim() };
  }

  return { kind: 'unknown' };
}

/** Read the working-tree status. Always a live read; never cached here. */
export async function readStatus(repoPath: string): Promise<WorkingTreeStatus> {
  const result = await runGitIn(repoPath, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=normal',
  ]);
  if (!result.ok) {
    throw new DevAtlasError('GIT_ERROR', 'git status failed', {
      detail: result.stderr.trim(),
    });
  }
  return parsePorcelainStatus(result.stdout);
}

/** List local and remote-tracking branches plus the current HEAD state. */
export async function listBranches(repoPath: string): Promise<BranchListing> {
  const [refs, head] = await Promise.all([
    runGitIn(repoPath, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes']),
    readHead(repoPath),
  ]);

  if (!refs.ok) {
    throw new DevAtlasError('GIT_REFUSED', 'Could not list branches.', {
      detail: refs.stderr.trim(),
    });
  }

  const { local, remote } = parseBranchListing(refs.stdout);

  // An unborn branch has no ref yet, so for-each-ref cannot report it. Surface
  // it anyway so a freshly-initialized repository shows its branch name.
  if (head.kind === 'unborn' && head.branch && !local.some((b) => b.name === head.branch)) {
    local.unshift({
      name: head.branch,
      ref: `refs/heads/${head.branch}`,
      kind: 'local',
      sha: '',
      current: true,
    });
  }

  return {
    local,
    remote,
    current: head.kind === 'branch' || head.kind === 'unborn' ? head.branch : undefined,
    head,
  };
}

export interface SwitchOutcome {
  ok: boolean;
  /** Set when the switch created a local branch tracking a remote one. */
  createdTrackingBranch?: string;
  detail?: string;
}

/**
 * Check out `branch`.
 *
 * Only two forms are ever executed:
 *   git -C <path> switch <local-branch>
 *   git -C <path> switch --track <remote>/<branch>
 *
 * Neither can discard work: `git switch` without --force refuses to leave the
 * branch when local changes would be overwritten, and --track only creates a
 * new branch when one does not already exist. No --force, --discard-changes,
 * reset, clean, stash, commit, merge or rebase is ever run — exec.ts rejects
 * those at the choke point regardless of what a caller asks for.
 */
export async function switchBranch(
  repoPath: string,
  target: BranchInfo,
): Promise<SwitchOutcome> {
  if (target.kind === 'local') {
    const result = await runGitIn(repoPath, ['switch', '--', target.name]);
    return result.ok
      ? { ok: true }
      : { ok: false, detail: (result.stderr || result.stdout).trim() };
  }

  const localName = target.remoteOnlyLocalName;
  if (!localName) {
    // A local branch of this name already exists; switch to that instead of
    // creating a confusing duplicate.
    const fallback = target.name.includes('/')
      ? target.name.slice(target.name.indexOf('/') + 1)
      : target.name;
    const result = await runGitIn(repoPath, ['switch', '--', fallback]);
    return result.ok
      ? { ok: true }
      : { ok: false, detail: (result.stderr || result.stdout).trim() };
  }

  const result = await runGitIn(repoPath, ['switch', '--track', target.name]);
  return result.ok
    ? { ok: true, createdTrackingBranch: localName }
    : { ok: false, detail: (result.stderr || result.stdout).trim() };
}

export interface RepositoryProbe {
  ok: boolean;
  problem?: RepositoryProblem;
  detail?: string;
}

/** Verify a stored repository path still exists and is still a Git work tree. */
export async function probeRepository(repoPath: string): Promise<RepositoryProbe> {
  try {
    const stats = await fs.stat(repoPath);
    if (!stats.isDirectory()) {
      return { ok: false, problem: 'missing', detail: `${repoPath} is not a directory` };
    }
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'ENOENT') {
      return { ok: false, problem: 'missing', detail: `${repoPath} no longer exists` };
    }
    return { ok: false, problem: 'inaccessible', detail: `Cannot read ${repoPath} (${code})` };
  }

  const result = await runGitIn(repoPath, ['rev-parse', '--is-inside-work-tree']);
  if (!result.ok) {
    if (result.failure === 'missing-git') {
      return { ok: false, problem: 'git-error', detail: 'git executable not found' };
    }
    return {
      ok: false,
      problem: 'not-a-repository',
      detail: result.stderr.trim() || 'not a git repository',
    };
  }
  return { ok: true };
}

/** Display name for a repository root: its directory basename. */
export function repositoryName(absolutePath: string): string {
  return path.basename(absolutePath) || absolutePath;
}
