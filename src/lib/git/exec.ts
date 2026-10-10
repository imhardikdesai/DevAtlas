import { execFile } from 'node:child_process';

import { errnoCode } from '@/lib/errors';
import type { GitResult } from '@/types';

const GIT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Commands and flags DevAtlas must never run. Enforced here at the single choke
 * point every Git call passes through, so a mistake elsewhere in the codebase
 * fails loudly instead of silently destroying a user's work.
 *
 * See spec §8.3: no automatic reset/clean/stash/commit/merge/rebase, and no
 * force-switching.
 */
const FORBIDDEN_SUBCOMMANDS = new Set([
  'reset',
  'clean',
  'stash',
  'commit',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'push',
  'am',
  'apply',
  'restore',
  'rm',
  'mv',
  'gc',
  'prune',
  'filter-branch',
]);

const FORBIDDEN_FLAGS = new Set([
  '-f',
  '--force',
  '--hard',
  '--discard-changes',
  '--ignore-unmerged',
  '--force-with-lease',
]);

/**
 * Environment every Git child process runs with. Credential prompts are
 * disabled outright so no operation can ever hang waiting on a password, and
 * optional locks are skipped so read-only status calls cannot fight a running
 * editor for the index lock.
 */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '0',
    LC_ALL: 'C',
    LANG: 'C',
  };
}

export class ForbiddenGitCommandError extends Error {
  constructor(token: string) {
    super(`Refusing to run a destructive git operation: ${token}`);
    this.name = 'ForbiddenGitCommandError';
  }
}

/** Throws if `args` contains a destructive subcommand or flag. */
export function assertSafeGitArgs(args: readonly string[]): void {
  for (const arg of args) {
    if (FORBIDDEN_FLAGS.has(arg)) throw new ForbiddenGitCommandError(arg);
  }
  // The subcommand is the first token that is not a global option such as
  // `-C <path>` or `-c key=value`.
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '-C' || arg === '-c' || arg === '--git-dir' || arg === '--work-tree') {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    if (FORBIDDEN_SUBCOMMANDS.has(arg)) throw new ForbiddenGitCommandError(arg);
    return;
  }
}

/**
 * Run git with an argument array. There is no shell involved anywhere, so no
 * user-controlled value — branch name, path, group name — can ever be
 * interpreted as shell syntax.
 *
 * Throws {@link ForbiddenGitCommandError} *synchronously* if `args` names a
 * destructive operation: that is a programming error, and failing before the
 * promise is even created guarantees no child process is spawned.
 */
export function runGit(
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<GitResult> {
  assertSafeGitArgs(args);

  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      {
        cwd: options.cwd,
        env: gitEnv(),
        timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true, code: 0, stdout, stderr });
          return;
        }

        const code = errnoCode(error);
        if (code === 'ENOENT') {
          resolve({
            ok: false,
            code: null,
            stdout: '',
            stderr: 'git executable not found',
            failure: 'missing-git',
          });
          return;
        }
        if (code === 'ETIMEDOUT' || (error as { killed?: boolean }).killed) {
          resolve({
            ok: false,
            code: null,
            stdout,
            stderr: stderr || 'git timed out',
            failure: 'timeout',
          });
          return;
        }

        const exitCode = (error as { code?: unknown }).code;
        resolve({
          ok: false,
          code: typeof exitCode === 'number' ? exitCode : null,
          stdout,
          stderr: stderr || error.message,
          failure: typeof exitCode === 'number' ? undefined : 'spawn-error',
        });
      },
    );
  });
}

/** Convenience wrapper for repository-scoped commands (`git -C <path> ...`). */
export function runGitIn(
  repoPath: string,
  args: readonly string[],
  options: { timeoutMs?: number } = {},
): Promise<GitResult> {
  return runGit(['-C', repoPath, ...args], options);
}

let gitAvailability: Promise<boolean> | undefined;

/** True when a usable `git` executable is on PATH. Cached per process. */
export function isGitAvailable(): Promise<boolean> {
  gitAvailability ??= runGit(['--version'], { timeoutMs: 5_000 }).then((r) => r.ok);
  return gitAvailability;
}

/** Test-only: forget the cached `git --version` probe. */
export function resetGitAvailabilityCache(): void {
  gitAvailability = undefined;
}
