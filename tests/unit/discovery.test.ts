import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { discoverRepositories } from '@/lib/discovery/discover';
import { listBranches, readHead, readStatus } from '@/lib/git/repository';
import {
  addRemote,
  createSandbox,
  git,
  makeBranchWithContent,
  makeRepo,
  writeFile,
  type Sandbox,
} from '../helpers/sandbox';

let sandbox: Sandbox;
let ws: string;

beforeEach(async () => {
  sandbox = await createSandbox('devatlas-discover-');
  ws = path.join(sandbox.root, 'workspace');
  await fs.mkdir(ws, { recursive: true });
  // The library shells out to git, which must see the sandbox config.
  process.env.GIT_CONFIG_GLOBAL = sandbox.env.GIT_CONFIG_GLOBAL;
});
afterEach(async () => {
  delete process.env.GIT_CONFIG_GLOBAL;
  await sandbox.cleanup();
});

const relatives = (result: { repositories: { relativePath: string }[] }) =>
  result.repositories.map((r) => r.relativePath).sort();

describe('discoverRepositories', () => {
  it('finds a repository at the workspace root', async () => {
    await makeRepo(sandbox, ws);
    expect(relatives(await discoverRepositories(ws))).toEqual(['.']);
  });

  it('finds nested independent repositories at varying depths', async () => {
    await makeRepo(sandbox, path.join(ws, 'frontend'));
    await makeRepo(sandbox, path.join(ws, 'services', 'api'));
    await makeRepo(sandbox, path.join(ws, 'a', 'b', 'c', 'deep'));

    expect(relatives(await discoverRepositories(ws))).toEqual([
      'a/b/c/deep',
      'frontend',
      'services/api',
    ]);
  });

  it('finds a repository nested inside another repository', async () => {
    await makeRepo(sandbox, ws);
    await makeRepo(sandbox, path.join(ws, 'vendor', 'library'));

    expect(relatives(await discoverRepositories(ws))).toEqual(['.', 'vendor/library']);
  });

  it('never reports a plain subdirectory of a repository', async () => {
    await makeRepo(sandbox, path.join(ws, 'app'));
    await fs.mkdir(path.join(ws, 'app', 'src', 'components'), { recursive: true });
    await fs.mkdir(path.join(ws, 'app', 'docs'), { recursive: true });

    expect(relatives(await discoverRepositories(ws))).toEqual(['app']);
  });

  it('skips dependency and build directories', async () => {
    await makeRepo(sandbox, path.join(ws, 'app'));
    for (const skipped of ['node_modules', '.next', 'dist', 'build', 'coverage']) {
      await makeRepo(sandbox, path.join(ws, skipped, 'planted'));
    }
    // ...including ones nested inside a real repository.
    await makeRepo(sandbox, path.join(ws, 'app', 'node_modules', 'planted'));

    expect(relatives(await discoverRepositories(ws))).toEqual(['app']);
  });

  it('skips the .devatlas configuration directory', async () => {
    await makeRepo(sandbox, path.join(ws, 'app'));
    await makeRepo(sandbox, path.join(ws, '.devatlas', 'planted'));
    expect(relatives(await discoverRepositories(ws))).toEqual(['app']);
  });

  it('reports each repository exactly once', async () => {
    await makeRepo(sandbox, ws);
    await makeRepo(sandbox, path.join(ws, 'frontend'));
    const result = await discoverRepositories(ws);
    const seen = new Set(result.repositories.map((r) => r.absolutePath));
    expect(seen.size).toBe(result.repositories.length);
  });

  it('handles a .git file — a linked worktree — as a real repository', async () => {
    const main = path.join(ws, 'main-repo');
    await makeRepo(sandbox, main);
    await git(sandbox, main, ['branch', 'wt-branch']);

    const worktree = path.join(ws, 'linked-worktree');
    await git(sandbox, main, ['worktree', 'add', '-q', worktree, 'wt-branch']);

    // A linked worktree records its git dir in a .git *file*, not a directory.
    const gitEntry = await fs.stat(path.join(worktree, '.git'));
    expect(gitEntry.isFile()).toBe(true);

    expect(relatives(await discoverRepositories(ws))).toEqual(['linked-worktree', 'main-repo']);
  });

  it('ignores a directory that only looks like a repository', async () => {
    await makeRepo(sandbox, path.join(ws, 'real'));
    // A bare `.git` directory with nothing valid in it.
    await fs.mkdir(path.join(ws, 'fake', '.git'), { recursive: true });

    const result = await discoverRepositories(ws);
    expect(relatives(result)).toEqual(['real']);
    expect(result.warnings.some((w) => w.path.includes('fake'))).toBe(true);
  });

  it('does not follow a symlink that escapes the workspace', async () => {
    await makeRepo(sandbox, path.join(ws, 'inside'));
    const outside = path.join(sandbox.root, 'outside');
    await makeRepo(sandbox, outside);
    await fs.symlink(outside, path.join(ws, 'escape'), 'dir');

    expect(relatives(await discoverRepositories(ws))).toEqual(['inside']);
  });

  it('terminates on a symlink cycle', async () => {
    await makeRepo(sandbox, path.join(ws, 'app'));
    await fs.symlink(ws, path.join(ws, 'loop'), 'dir');

    const result = await discoverRepositories(ws);
    expect(relatives(result)).toEqual(['app']);
  });

  it('keeps going when a directory cannot be read', async () => {
    await makeRepo(sandbox, path.join(ws, 'readable'));
    const locked = path.join(ws, 'locked');
    await fs.mkdir(locked, { recursive: true });
    await fs.chmod(locked, 0o000);

    try {
      const result = await discoverRepositories(ws);
      expect(relatives(result)).toEqual(['readable']);
      expect(result.warnings.some((w) => w.path === locked)).toBe(true);
    } finally {
      await fs.chmod(locked, 0o755);
    }
  });

  it('returns nothing for a workspace with no repositories', async () => {
    await fs.mkdir(path.join(ws, 'just', 'folders'), { recursive: true });
    const result = await discoverRepositories(ws);
    expect(result.repositories).toEqual([]);
  });
});

describe('live git reads', () => {
  it('reports a normal branch', async () => {
    const repo = await makeRepo(sandbox, path.join(ws, 'app'));
    expect(await readHead(repo)).toMatchObject({ kind: 'branch', branch: 'main' });
  });

  it('reports a detached HEAD', async () => {
    const repo = await makeRepo(sandbox, path.join(ws, 'app'));
    await git(sandbox, repo, ['switch', '-q', '--detach', 'HEAD']);

    const head = await readHead(repo);
    expect(head.kind).toBe('detached');
    expect(head.commit).toMatch(/^[0-9a-f]{4,}$/);
  });

  it('reports a repository with no commits as an unborn branch', async () => {
    const repo = await makeRepo(sandbox, path.join(ws, 'fresh'), { commit: false });
    expect(await readHead(repo)).toMatchObject({ kind: 'unborn', branch: 'main' });
  });

  it('still lists the unborn branch so the UI has something to show', async () => {
    const repo = await makeRepo(sandbox, path.join(ws, 'fresh'), { commit: false });
    const listing = await listBranches(repo);
    expect(listing.local.map((b) => b.name)).toEqual(['main']);
    expect(listing.remote).toEqual([]);
    expect(listing.current).toBe('main');
  });

  it('counts staged, unstaged and untracked changes from a real repository', async () => {
    const repo = await makeRepo(sandbox, path.join(ws, 'app'));
    await writeFile(path.join(repo, 'staged.txt'), 'a');
    await git(sandbox, repo, ['add', 'staged.txt']);
    await writeFile(path.join(repo, 'README.md'), '# changed\n');
    await writeFile(path.join(repo, 'untracked.txt'), 'c');

    const status = await readStatus(repo);
    expect(status).toMatchObject({ clean: false, staged: 1, unstaged: 1, untracked: 1 });
  });

  it('distinguishes local branches from remote-tracking ones', async () => {
    const repo = await makeRepo(sandbox, path.join(ws, 'app'));
    await makeBranchWithContent(sandbox, repo, 'feature', '# feature\n');
    await addRemote(sandbox, repo, path.join(sandbox.root, 'origin.git'), ['main', 'feature']);
    await git(sandbox, repo, ['branch', '-D', 'feature']);
    await git(sandbox, repo, ['fetch', '-q', 'origin']);

    const listing = await listBranches(repo);
    expect(listing.local.map((b) => b.name)).toEqual(['main']);
    expect(listing.remote.map((b) => b.name).sort()).toEqual(['origin/feature', 'origin/main']);

    // feature exists only on the remote, so switching must create a local branch.
    const feature = listing.remote.find((b) => b.name === 'origin/feature');
    expect(feature?.remoteOnlyLocalName).toBe('feature');
    // main exists locally, so it must not be offered as a new branch.
    expect(listing.remote.find((b) => b.name === 'origin/main')?.remoteOnlyLocalName)
      .toBeUndefined();
  });
});
