import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configPath, dataPath } from '@/lib/config/paths';
import { createSandbox, exists, makeRepo, readFileText, type Sandbox } from '../helpers/sandbox';

const exec = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repoRoot, 'bin', 'devatlas.js');

let sandbox: Sandbox;
let ws: string;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  all: string;
}

/**
 * Run the CLI the way a user would, from a working directory that is
 * deliberately *not* the DevAtlas source tree — that is what proves the CLI
 * locates its packaged application relative to itself (spec §5.6, §13.20).
 */
async function runCli(args: string[], cwd = os.tmpdir()): Promise<CliResult> {
  try {
    const { stdout, stderr } = await exec(process.execPath, [cli, ...args], {
      cwd,
      env: { ...sandbox.env, NO_COLOR: '1' },
      timeout: 120_000,
    });
    return { code: 0, stdout, stderr, all: stdout + stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    const stdout = e.stdout ?? '';
    const stderr = e.stderr ?? '';
    return { code: typeof e.code === 'number' ? e.code : 1, stdout, stderr, all: stdout + stderr };
  }
}

beforeEach(async () => {
  sandbox = await createSandbox('devatlas-cli-');
  ws = path.join(sandbox.root, 'my-project');
  await fs.mkdir(ws, { recursive: true });
});
afterEach(async () => {
  await sandbox.cleanup();
});

describe('devatlas init', () => {
  it('initializes the current working directory', async () => {
    await makeRepo(sandbox, path.join(ws, 'frontend'));
    await makeRepo(sandbox, path.join(ws, 'backend'));

    // No path argument: the workspace is wherever the user is standing.
    const result = await runCli(['init', '--no-open', '--no-start'], ws);

    expect(result.code).toBe(0);
    expect(result.all).toContain('Discovered 2 repositories.');
    expect(result.all).toContain('Configuration created successfully.');
    expect(await exists(configPath(ws))).toBe(true);

    const config = JSON.parse(await readFileText(configPath(ws)));
    expect(config.name).toBe('my-project');
    expect(config.rootPath).toBe(ws);
  });

  it('initializes a relative path supplied as an argument', async () => {
    await makeRepo(sandbox, path.join(ws, 'app'));
    const result = await runCli(['init', './my-project', '--no-open', '--no-start'], sandbox.root);

    expect(result.code).toBe(0);
    expect(result.all).toContain('Discovered 1 repository.');
    expect(await exists(configPath(ws))).toBe(true);
  });

  it('initializes an absolute path supplied as an argument', async () => {
    await makeRepo(sandbox, path.join(ws, 'app'));
    const result = await runCli(['init', ws, '--no-open', '--no-start'], os.tmpdir());

    expect(result.code).toBe(0);
    expect(await exists(configPath(ws))).toBe(true);
  });

  it('reports an accurate count, not a hardcoded one', async () => {
    for (const name of ['one', 'two', 'three', 'nested/four']) {
      await makeRepo(sandbox, path.join(ws, name));
    }
    const result = await runCli(['init', ws, '--no-open', '--no-start']);
    expect(result.all).toContain('Discovered 4 repositories.');
  });

  it('says so plainly when there is nothing to discover', async () => {
    const result = await runCli(['init', ws, '--no-open', '--no-start']);
    expect(result.code).toBe(0);
    expect(result.all).toContain('No Git repositories were discovered');
  });

  it('rejects a path that does not exist', async () => {
    const missing = path.join(sandbox.root, 'no-such-directory');
    const result = await runCli(['init', missing, '--no-open', '--no-start']);

    expect(result.code).toBe(1);
    expect(result.all).toContain('No such directory');
    expect(await exists(missing)).toBe(false);
  });

  it('rejects a path that is a file', async () => {
    const file = path.join(sandbox.root, 'a-file.txt');
    await fs.writeFile(file, 'x', 'utf8');
    const result = await runCli(['init', file, '--no-open', '--no-start']);

    expect(result.code).toBe(1);
    expect(result.all).toContain('Not a directory');
  });

  it('preserves an existing workspace rather than resetting it', async () => {
    await makeRepo(sandbox, path.join(ws, 'app'));
    await runCli(['init', ws, '--no-open', '--no-start']);

    const original = JSON.parse(await readFileText(configPath(ws)));

    // Simulate user state: a renamed workspace and a group assignment.
    const data = JSON.parse(await readFileText(dataPath(ws)));
    await fs.writeFile(
      configPath(ws),
      JSON.stringify({ ...original, name: 'Renamed By User' }, null, 2),
      'utf8',
    );
    await fs.writeFile(
      dataPath(ws),
      JSON.stringify(
        {
          ...data,
          groups: [
            { id: 'g1', name: 'Mine', repositoryIds: [data.repositories[0].id] },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await runCli(['init', ws, '--no-open', '--no-start']);
    expect(result.code).toBe(0);
    expect(result.all).toContain('already a DevAtlas workspace');

    const after = JSON.parse(await readFileText(configPath(ws)));
    expect(after.name).toBe('Renamed By User');
    expect(after.workspaceId).toBe(original.workspaceId);
    expect(after.createdAt).toBe(original.createdAt);

    const dataAfter = JSON.parse(await readFileText(dataPath(ws)));
    expect(dataAfter.groups).toHaveLength(1);
    expect(dataAfter.groups[0].name).toBe('Mine');
    expect(dataAfter.groups[0].repositoryIds).toHaveLength(1);
  });

  it('reports an invalid config without repairing or deleting it', async () => {
    await runCli(['init', ws, '--no-open', '--no-start']);
    const broken = '{ this is not valid json';
    await fs.writeFile(configPath(ws), broken, 'utf8');

    const result = await runCli(['init', ws, '--no-open', '--no-start']);

    expect(result.code).toBe(1);
    expect(result.all).toContain('not valid JSON');
    expect(result.all).toContain('DevAtlas has not changed any of your files');
    // The damaged file is exactly as the user left it.
    expect(await readFileText(configPath(ws))).toBe(broken);
    expect(await exists(dataPath(ws))).toBe(true);
  });
});

describe('--no-start', () => {
  it('prepares the workspace and exits without serving anything', async () => {
    await makeRepo(sandbox, path.join(ws, 'app'));
    const result = await runCli(['init', ws, '--no-open', '--no-start']);

    expect(result.code).toBe(0);
    expect(result.all).toContain('Workspace is ready');
    // No server was started, so no runtime record was written.
    expect(await exists(path.join(ws, '.devatlas', 'runtime.json'))).toBe(false);
    expect(await exists(configPath(ws))).toBe(true);
  });
});

describe('devatlas start', () => {
  it('refuses to start an uninitialized directory, with an actionable hint', async () => {
    const result = await runCli(['start', ws, '--no-open']);

    expect(result.code).toBe(1);
    expect(result.all).toContain('is not a DevAtlas workspace');
    expect(result.all).toContain('devatlas init');
    // It must not have quietly initialized it.
    expect(await exists(configPath(ws))).toBe(false);
  });
});

describe('port selection', () => {
  it('falls back to the next free port and prints the real URL', async () => {
    await makeRepo(sandbox, path.join(ws, 'app'));
    await runCli(['init', ws, '--no-open', '--no-start']);

    // Occupy the port DevAtlas would prefer.
    const blocker = net.createServer();
    const preferred = await new Promise<number>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen({ port: 0, host: '127.0.0.1' }, () => {
        const address = blocker.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    try {
      const child = execFile(
        process.execPath,
        [cli, 'start', ws, '--no-open', '--port', String(preferred)],
        { env: { ...sandbox.env, NO_COLOR: '1' } },
      );

      let output = '';
      child.stdout?.on('data', (c: Buffer) => {
        output += c.toString('utf8');
      });
      child.stderr?.on('data', (c: Buffer) => {
        output += c.toString('utf8');
      });

      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline && !output.includes('Dashboard:')) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const url = /Dashboard:\s*(\S+)/.exec(output)?.[1];
      expect(url).toBeDefined();

      const actualPort = Number(new URL(url!).port);
      expect(actualPort).not.toBe(preferred);
      expect(actualPort).toBeGreaterThan(preferred);

      // The printed URL is real: the server answers on it.
      const health = await fetch(`${url}/api/health`);
      expect(health.ok).toBe(true);

      child.kill('SIGINT');
      await new Promise((resolve) => child.once('exit', resolve));
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  }, 180_000);
});

describe('packaging', () => {
  /**
   * An installed DevAtlas lives at node_modules/devatlas, and the CLI must
   * locate its own packaged application from there — from any cwd. This was a
   * real failure: a guard that skipped anything under node_modules rejected
   * the genuine install location and broke every published copy.
   */
  it('resolves its own package when installed under node_modules', async () => {
    const fakeInstall = path.join(sandbox.root, 'prefix', 'node_modules', 'devatlas');
    await fs.mkdir(path.join(fakeInstall, 'dist', 'cli'), { recursive: true });
    await fs.cp(path.join(repoRoot, 'dist'), path.join(fakeInstall, 'dist'), {
      recursive: true,
      force: true,
    });
    await fs.cp(path.join(repoRoot, 'bin'), path.join(fakeInstall, 'bin'), {
      recursive: true,
      force: true,
    });
    await fs.copyFile(
      path.join(repoRoot, 'package.json'),
      path.join(fakeInstall, 'package.json'),
    );
    // tsup leaves declared dependencies external, exactly as a published
    // package does, so the fixture needs them resolvable the way npm install
    // would make them.
    await fs.symlink(
      path.join(repoRoot, 'node_modules'),
      path.join(fakeInstall, 'node_modules'),
      'dir',
    );

    // A decoy manifest on the way up must not be mistaken for ours.
    await fs.writeFile(
      path.join(sandbox.root, 'prefix', 'package.json'),
      JSON.stringify({ name: 'something-else', version: '0.0.0' }),
      'utf8',
    );

    const { stdout } = await exec(
      process.execPath,
      [path.join(fakeInstall, 'bin', 'devatlas.js'), 'version'],
      { cwd: os.tmpdir(), env: { ...sandbox.env, NO_COLOR: '1' } },
    );

    const expected = JSON.parse(
      await readFileText(path.join(repoRoot, 'package.json')),
    ).version;
    expect(stdout.trim()).toBe(expected);
  });
});

describe('argument handling', () => {
  it('prints usage for help', async () => {
    const result = await runCli(['help']);
    expect(result.code).toBe(0);
    expect(result.all).toContain('devatlas init');
    expect(result.all).toContain('devatlas start');
  });

  it('prints the real version, never a placeholder', async () => {
    const result = await runCli(['version']);
    const expected = JSON.parse(
      await readFileText(path.join(repoRoot, 'package.json')),
    ).version;

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
    expect(result.stdout).not.toContain('unknown');
  });

  it('rejects an unknown command and an invalid port', async () => {
    expect((await runCli(['frobnicate'])).code).toBe(2);
    expect((await runCli(['init', '--port', 'abc'])).code).toBe(2);
    expect((await runCli(['init', '--port', '99999'])).code).toBe(2);
  });
});
