import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configPath, dataPath } from '@/lib/config/paths';
import { atomicWriteFile, withFileLock } from '@/lib/persistence/atomic';
import {
  ensureWorkspace,
  mergeRepositories,
  readConfig,
  readData,
  renameWorkspace,
  repositoryId,
  updateData,
} from '@/lib/workspace/store';
import { createSandbox, exists, readFileText, type Sandbox } from '../helpers/sandbox';

let sandbox: Sandbox;

beforeEach(async () => {
  sandbox = await createSandbox('devatlas-persist-');
});
afterEach(async () => {
  await sandbox.cleanup();
});

describe('atomicWriteFile', () => {
  it('leaves no temporary files behind', async () => {
    const target = path.join(sandbox.root, 'out.json');
    await atomicWriteFile(target, '{"a":1}');
    expect(await readFileText(target)).toBe('{"a":1}');
    const siblings = await fs.readdir(sandbox.root);
    expect(siblings.filter((n) => n.includes('.tmp-'))).toHaveLength(0);
  });

  it('replaces the previous contents completely, never partially', async () => {
    const target = path.join(sandbox.root, 'out.json');
    await atomicWriteFile(target, 'a'.repeat(5000));
    await atomicWriteFile(target, 'short');
    expect(await readFileText(target)).toBe('short');
  });
});

describe('withFileLock', () => {
  it('serializes concurrent read-modify-write cycles', async () => {
    const target = path.join(sandbox.root, 'counter.txt');
    await atomicWriteFile(target, '0');

    // Without the lock these interleave and the final count is wrong.
    await Promise.all(
      Array.from({ length: 25 }, () =>
        withFileLock(target, async () => {
          const current = Number(await readFileText(target));
          await new Promise((resolve) => setTimeout(resolve, 1));
          await atomicWriteFile(target, String(current + 1));
        }),
      ),
    );

    expect(await readFileText(target)).toBe('25');
  });

  it('does not let a rejected operation block later ones', async () => {
    const target = path.join(sandbox.root, 'x.txt');
    await expect(
      withFileLock(target, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(withFileLock(target, async () => 'fine')).resolves.toBe('fine');
  });
});

describe('ensureWorkspace', () => {
  it('creates configuration named after the directory', async () => {
    const { config, created } = await ensureWorkspace(sandbox.root);
    expect(created).toBe(true);
    expect(config.name).toBe(path.basename(sandbox.root));
    expect(config.rootPath).toBe(sandbox.root);
    expect(config.workspaceId).toMatch(/[0-9a-f-]{36}/);
  });

  it('preserves an existing name and id when run again', async () => {
    const first = await ensureWorkspace(sandbox.root);
    await renameWorkspace(sandbox.root, 'Renamed By User');

    const second = await ensureWorkspace(sandbox.root);
    expect(second.created).toBe(false);
    expect(second.config.workspaceId).toBe(first.config.workspaceId);
    expect(second.config.name).toBe('Renamed By User');
    expect(second.config.createdAt).toBe(first.config.createdAt);
  });
});

describe('readConfig / readData with damaged files', () => {
  it('reports malformed JSON without touching the file', async () => {
    await ensureWorkspace(sandbox.root);
    const file = configPath(sandbox.root);
    const broken = '{ not json at all';
    await fs.writeFile(file, broken, 'utf8');

    await expect(readConfig(sandbox.root)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    // The crucial part: the damaged file is still exactly as the user left it.
    expect(await readFileText(file)).toBe(broken);
  });

  it('reports a schema mismatch without rewriting the file', async () => {
    await ensureWorkspace(sandbox.root);
    const file = configPath(sandbox.root);
    const wrongShape = JSON.stringify({ schemaVersion: 1, name: '' });
    await fs.writeFile(file, wrongShape, 'utf8');

    await expect(readConfig(sandbox.root)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(await readFileText(file)).toBe(wrongShape);
  });

  it('refuses a config written by a newer schema version', async () => {
    await ensureWorkspace(sandbox.root);
    const config = JSON.parse(await readFileText(configPath(sandbox.root)));
    await fs.writeFile(
      configPath(sandbox.root),
      JSON.stringify({ ...config, schemaVersion: 99 }),
      'utf8',
    );
    await expect(readConfig(sandbox.root)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('treats a missing data.json as empty rather than an error', async () => {
    await ensureWorkspace(sandbox.root);
    expect(await exists(dataPath(sandbox.root))).toBe(false);
    await expect(readData(sandbox.root)).resolves.toMatchObject({
      repositories: [],
      groups: [],
    });
  });
});

describe('renameWorkspace', () => {
  it('trims the name and never renames the directory', async () => {
    await ensureWorkspace(sandbox.root);
    const before = await fs.readdir(path.dirname(sandbox.root));

    const config = await renameWorkspace(sandbox.root, '   Acme Platform   ');
    expect(config.name).toBe('Acme Platform');
    expect(config.rootPath).toBe(sandbox.root);

    const after = await fs.readdir(path.dirname(sandbox.root));
    expect(after).toEqual(before);
    expect(await exists(sandbox.root)).toBe(true);
  });

  it('rejects an empty or whitespace-only name', async () => {
    await ensureWorkspace(sandbox.root);
    await expect(renameWorkspace(sandbox.root, '   ')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(renameWorkspace(sandbox.root, '')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('refuses on a directory that was never initialized', async () => {
    await expect(renameWorkspace(sandbox.root, 'Nope')).rejects.toMatchObject({
      code: 'NOT_INITIALIZED',
    });
  });
});

describe('updateData', () => {
  it('serializes concurrent group writes so none are lost', async () => {
    await ensureWorkspace(sandbox.root);

    await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        updateData(sandbox.root, (data) => ({
          data: {
            ...data,
            groups: [
              ...data.groups,
              { id: `g${index}`, name: `Group ${index}`, repositoryIds: [] },
            ],
          },
          result: null,
        })),
      ),
    );

    const data = await readData(sandbox.root);
    expect(data.groups).toHaveLength(10);
  });
});

describe('mergeRepositories', () => {
  const existing = {
    repositories: [
      {
        id: repositoryId('frontend'),
        name: 'frontend',
        absolutePath: '/ws/frontend',
        relativePath: 'frontend',
        available: true,
      },
      {
        id: repositoryId('gone'),
        name: 'gone',
        absolutePath: '/ws/gone',
        relativePath: 'gone',
        available: true,
      },
    ],
    groups: [
      { id: 'g1', name: 'Frontend', repositoryIds: [repositoryId('frontend')] },
      { id: 'g2', name: 'Archive', repositoryIds: [repositoryId('gone')] },
    ],
  };

  it('keeps ids stable so group membership survives rediscovery', () => {
    const merged = mergeRepositories(existing, [
      { relativePath: 'frontend', absolutePath: '/ws/frontend', name: 'frontend' },
    ]);

    const frontend = merged.repositories.find((r) => r.relativePath === 'frontend');
    expect(frontend?.id).toBe(repositoryId('frontend'));
    expect(merged.groups.find((g) => g.id === 'g1')?.repositoryIds).toEqual([
      repositoryId('frontend'),
    ]);
  });

  it('retains a repository that disappeared, marked unavailable', () => {
    const merged = mergeRepositories(existing, [
      { relativePath: 'frontend', absolutePath: '/ws/frontend', name: 'frontend' },
    ]);

    const gone = merged.repositories.find((r) => r.relativePath === 'gone');
    expect(gone).toBeDefined();
    expect(gone?.available).toBe(false);
    // Its group assignment is kept in case the repository comes back.
    expect(merged.groups.find((g) => g.id === 'g2')?.repositoryIds).toEqual([
      repositoryId('gone'),
    ]);
    expect(merged.removed).toBe(1);
  });

  it('adds newly discovered repositories', () => {
    const merged = mergeRepositories(existing, [
      { relativePath: 'frontend', absolutePath: '/ws/frontend', name: 'frontend' },
      { relativePath: 'gone', absolutePath: '/ws/gone', name: 'gone' },
      { relativePath: 'services/api', absolutePath: '/ws/services/api', name: 'api' },
    ]);
    expect(merged.added).toBe(1);
    expect(merged.removed).toBe(0);
    expect(merged.repositories).toHaveLength(3);
  });
});
