import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Every test runs against a throwaway workspace under the OS temp directory,
 * with its own git config. Nothing here can touch a real repository: the git
 * identity, default branch and protocol settings are confined to the sandbox.
 */
export interface Sandbox {
  root: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}

export async function createSandbox(prefix = 'devatlas-test-'): Promise<Sandbox> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  // macOS reports /var and /private/var for the same place; canonicalize so
  // containment comparisons in the code under test line up with the tests.
  const root = await fs.realpath(base);

  const gitconfig = path.join(root, '.gitconfig');
  await fs.writeFile(
    gitconfig,
    [
      '[user]',
      '  name = DevAtlas Test',
      '  email = test@example.invalid',
      '[init]',
      '  defaultBranch = main',
      '[commit]',
      '  gpgsign = false',
      '[protocol "file"]',
      '  allow = always',
      '',
    ].join('\n'),
    'utf8',
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_SYSTEM: '/dev/null',
    HOME: root,
  };

  return {
    root,
    env,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** Run git inside the sandbox, throwing on failure so tests fail loudly. */
export async function git(
  sandbox: Sandbox,
  cwd: string,
  args: string[],
): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, env: sandbox.env });
  return stdout.trim();
}

/** Create a git repository with one commit. */
export async function makeRepo(
  sandbox: Sandbox,
  repoPath: string,
  options: { commit?: boolean; file?: string; content?: string } = {},
): Promise<string> {
  await fs.mkdir(repoPath, { recursive: true });
  await git(sandbox, repoPath, ['init', '-q']);
  if (options.commit === false) return repoPath;

  const file = options.file ?? 'README.md';
  await fs.writeFile(path.join(repoPath, file), options.content ?? '# repo\n', 'utf8');
  await git(sandbox, repoPath, ['add', '-A']);
  await git(sandbox, repoPath, ['commit', '-qm', 'initial']);
  return repoPath;
}

/** Commit a change on a new branch, then return to the original branch. */
export async function makeBranchWithContent(
  sandbox: Sandbox,
  repoPath: string,
  branch: string,
  content: string,
): Promise<void> {
  const original = await git(sandbox, repoPath, ['branch', '--show-current']);
  await git(sandbox, repoPath, ['switch', '-qc', branch]);
  await fs.writeFile(path.join(repoPath, 'README.md'), content, 'utf8');
  await git(sandbox, repoPath, ['add', '-A']);
  await git(sandbox, repoPath, ['commit', '-qm', `content for ${branch}`]);
  await git(sandbox, repoPath, ['switch', '-q', original]);
}

/** Give `repoPath` a file-based remote with the named branches pushed to it. */
export async function addRemote(
  sandbox: Sandbox,
  repoPath: string,
  remotePath: string,
  branches: string[],
): Promise<void> {
  await git(sandbox, path.dirname(remotePath), ['init', '-q', '--bare', remotePath]);
  await git(sandbox, repoPath, ['remote', 'add', 'origin', remotePath]);
  for (const branch of branches) {
    await git(sandbox, repoPath, ['push', '-q', 'origin', branch]);
  }
  await git(sandbox, repoPath, ['fetch', '-q', 'origin']);
}

export async function writeFile(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

export async function readFileText(target: string): Promise<string> {
  return fs.readFile(target, 'utf8');
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
