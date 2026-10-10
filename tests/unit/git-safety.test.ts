import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ForbiddenGitCommandError, assertSafeGitArgs, runGit } from '@/lib/git/exec';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Spec §8.3: DevAtlas must never automatically run a command that can destroy
 * or rewrite a user's work. These tests pin that guarantee in two independent
 * ways — at the runtime choke point, and by reading the source itself — so a
 * future change cannot quietly reintroduce one.
 */
describe('forbidden git operations', () => {
  const destructive: string[][] = [
    ['reset', '--hard'],
    ['clean', '-fd'],
    ['stash'],
    ['stash', 'push'],
    ['commit', '-m', 'x'],
    ['merge', 'main'],
    ['rebase', 'main'],
    ['cherry-pick', 'abc123'],
    ['revert', 'abc123'],
    ['push', '--force'],
    ['restore', '.'],
    ['rm', '-rf', '.'],
  ];

  it.each(destructive)('refuses `git %s`', (...args) => {
    expect(() => assertSafeGitArgs(args)).toThrow(ForbiddenGitCommandError);
  });

  it('refuses destructive subcommands even behind global options', () => {
    expect(() => assertSafeGitArgs(['-C', '/some/path', 'reset', '--hard'])).toThrow(
      ForbiddenGitCommandError,
    );
    expect(() => assertSafeGitArgs(['-c', 'core.pager=cat', 'clean', '-fd'])).toThrow(
      ForbiddenGitCommandError,
    );
  });

  it('refuses force flags on an otherwise allowed command', () => {
    expect(() => assertSafeGitArgs(['switch', '--force', 'main'])).toThrow(
      ForbiddenGitCommandError,
    );
    expect(() => assertSafeGitArgs(['switch', '-f', 'main'])).toThrow(ForbiddenGitCommandError);
    expect(() => assertSafeGitArgs(['switch', '--discard-changes', 'main'])).toThrow(
      ForbiddenGitCommandError,
    );
  });

  it('allows the read-only and switch commands DevAtlas actually uses', () => {
    expect(() => assertSafeGitArgs(['status', '--porcelain=v1', '-z'])).not.toThrow();
    expect(() => assertSafeGitArgs(['for-each-ref', '--format=x', 'refs/heads'])).not.toThrow();
    expect(() => assertSafeGitArgs(['rev-parse', '--show-toplevel'])).not.toThrow();
    expect(() => assertSafeGitArgs(['symbolic-ref', '--quiet', '--short', 'HEAD'])).not.toThrow();
    expect(() => assertSafeGitArgs(['switch', '--', 'main'])).not.toThrow();
    expect(() => assertSafeGitArgs(['switch', '--track', 'origin/main'])).not.toThrow();
  });

  it('blocks at runtime before any process is spawned', () => {
    // runGit throws synchronously rather than rejecting: reaching it with a
    // destructive command is a programming error, and failing fast means no
    // child process is ever created.
    expect(() => runGit(['reset', '--hard'])).toThrow(ForbiddenGitCommandError);
    expect(() => runGit(['-C', '/tmp', 'clean', '-fd'])).toThrow(ForbiddenGitCommandError);
  });
});

describe('source-level guarantee', () => {
  /** Collect every .ts/.tsx file under src/. */
  async function sourceFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
    return files;
  }

  it('contains no destructive git invocation anywhere in src/', async () => {
    const files = await sourceFiles(path.join(repoRoot, 'src'));
    expect(files.length).toBeGreaterThan(10);

    // Matches a git argument array literal containing a destructive verb,
    // e.g. ['reset', ...] or ["stash"] — the only way such a command could run.
    const pattern =
      /\[\s*(['"])(reset|clean|stash|commit|merge|rebase|cherry-pick|revert|push)\1/;

    const offenders: string[] = [];
    for (const file of files) {
      // exec.ts holds the deny-list itself, so it legitimately names them.
      if (file.endsWith(path.join('lib', 'git', 'exec.ts'))) continue;
      const text = await fs.readFile(file, 'utf8');
      if (pattern.test(text)) offenders.push(path.relative(repoRoot, file));
    }

    expect(offenders).toEqual([]);
  });

  it('never builds a git command by string concatenation', async () => {
    const files = await sourceFiles(path.join(repoRoot, 'src'));
    const offenders: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      // `exec(` / `execSync(` run a shell string; DevAtlas only uses execFile.
      if (/\bexecSync\s*\(|[^a-zA-Z]exec\s*\(/.test(text)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
