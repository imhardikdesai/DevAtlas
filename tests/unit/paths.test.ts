import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertContained,
  isContained,
  resolveWorkspaceRoot,
  toRelativePath,
} from '@/lib/config/paths';
import { DevAtlasError } from '@/lib/errors';
import { createSandbox, type Sandbox } from '../helpers/sandbox';

let sandbox: Sandbox;

beforeAll(async () => {
  sandbox = await createSandbox('devatlas-paths-');
});
afterAll(async () => {
  await sandbox.cleanup();
});

describe('isContained', () => {
  it('accepts the directory itself and its descendants', () => {
    expect(isContained('/ws', '/ws')).toBe(true);
    expect(isContained('/ws/app', '/ws')).toBe(true);
    expect(isContained('/ws/a/b/c', '/ws')).toBe(true);
  });

  it('rejects a sibling whose name merely starts with the parent path', () => {
    // The classic prefix bug: /ws-evil must not count as inside /ws.
    expect(isContained('/ws-evil', '/ws')).toBe(false);
    expect(isContained('/ws-evil/app', '/ws')).toBe(false);
  });

  it('rejects paths outside the parent', () => {
    expect(isContained('/elsewhere', '/ws')).toBe(false);
    expect(isContained('/', '/ws')).toBe(false);
  });
});

describe('assertContained', () => {
  it('returns the canonical path for something inside the workspace', async () => {
    const inside = path.join(sandbox.root, 'inside');
    await fs.mkdir(inside, { recursive: true });
    await expect(assertContained(inside, sandbox.root)).resolves.toBe(inside);
  });

  it('rejects a symlink that escapes the workspace', async () => {
    const outside = path.join(sandbox.root, '..', `escape-${process.pid}`);
    await fs.mkdir(outside, { recursive: true });
    const link = path.join(sandbox.root, 'escape-link');
    await fs.symlink(outside, link, 'dir');

    try {
      await expect(assertContained(link, sandbox.root)).rejects.toMatchObject({
        code: 'PATH_ESCAPES_WORKSPACE',
      });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('reports a missing path as unavailable rather than crashing', async () => {
    await expect(
      assertContained(path.join(sandbox.root, 'nope'), sandbox.root),
    ).rejects.toMatchObject({ code: 'REPOSITORY_UNAVAILABLE' });
  });
});

describe('resolveWorkspaceRoot', () => {
  it('resolves a relative path against the given working directory', async () => {
    const nested = path.join(sandbox.root, 'nested');
    await fs.mkdir(nested, { recursive: true });
    await expect(resolveWorkspaceRoot('./nested', sandbox.root)).resolves.toBe(nested);
  });

  it('accepts an absolute path', async () => {
    await expect(resolveWorkspaceRoot(sandbox.root, '/')).resolves.toBe(sandbox.root);
  });

  it('rejects a path that does not exist', async () => {
    await expect(
      resolveWorkspaceRoot(path.join(sandbox.root, 'missing'), sandbox.root),
    ).rejects.toBeInstanceOf(DevAtlasError);
    await expect(
      resolveWorkspaceRoot(path.join(sandbox.root, 'missing'), sandbox.root),
    ).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
  });

  it('rejects a path that is a file rather than a directory', async () => {
    const file = path.join(sandbox.root, 'a-file.txt');
    await fs.writeFile(file, 'x', 'utf8');
    await expect(resolveWorkspaceRoot(file, sandbox.root)).rejects.toMatchObject({
      code: 'PATH_NOT_DIRECTORY',
    });
  });
});

describe('toRelativePath', () => {
  it('uses "." for the workspace root itself', () => {
    expect(toRelativePath('/ws', '/ws')).toBe('.');
  });

  it('always emits forward slashes so ids are stable across platforms', () => {
    expect(toRelativePath('/ws', path.join('/ws', 'services', 'api'))).toBe('services/api');
  });
});
