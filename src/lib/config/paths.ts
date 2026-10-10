import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DevAtlasError, errnoCode } from '@/lib/errors';

export const DEVATLAS_DIR = '.devatlas';
export const CONFIG_FILE = 'config.json';
export const DATA_FILE = 'data.json';
export const RUNTIME_FILE = 'runtime.json';

/** Directories never descended into during repository discovery. */
export const SKIPPED_DIRECTORIES = new Set([
  DEVATLAS_DIR,
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
]);

export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = '127.0.0.1';
/** Ports tried after DEFAULT_PORT when it is occupied. */
export const PORT_SCAN_RANGE = 20;

export function devAtlasDir(root: string): string {
  return path.join(root, DEVATLAS_DIR);
}
export function configPath(root: string): string {
  return path.join(devAtlasDir(root), CONFIG_FILE);
}
export function dataPath(root: string): string {
  return path.join(devAtlasDir(root), DATA_FILE);
}
export function runtimePath(root: string): string {
  return path.join(devAtlasDir(root), RUNTIME_FILE);
}

/** Expand a leading `~` and resolve against `cwd` into an absolute path. */
export function expandPath(input: string, cwd: string = process.cwd()): string {
  let value = input.trim();
  if (value === '~') value = os.homedir();
  else if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    value = path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(cwd, value);
}

/**
 * Resolve a user-supplied workspace path to a canonical absolute path,
 * verifying it exists and is a directory. Symlinks are resolved so that every
 * later containment check compares canonical paths.
 */
export async function resolveWorkspaceRoot(
  input: string | undefined,
  cwd: string = process.cwd(),
): Promise<string> {
  const target = expandPath(input ?? '.', cwd);

  let stats;
  try {
    stats = await fs.stat(target);
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'ENOENT') {
      throw new DevAtlasError('PATH_NOT_FOUND', `No such directory: ${target}`);
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new DevAtlasError('PATH_NOT_WRITABLE', `Permission denied reading ${target}`);
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    throw new DevAtlasError('PATH_NOT_DIRECTORY', `Not a directory: ${target}`);
  }

  return await fs.realpath(target);
}

/** Verify that DevAtlas can create its configuration directory under `root`. */
export async function assertWritableWorkspace(root: string): Promise<void> {
  try {
    await fs.mkdir(devAtlasDir(root), { recursive: true });
    const probe = path.join(devAtlasDir(root), `.write-probe-${process.pid}`);
    await fs.writeFile(probe, '', 'utf8');
    await fs.rm(probe, { force: true });
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new DevAtlasError(
        'PATH_NOT_WRITABLE',
        `DevAtlas cannot create its configuration in ${root}. Check directory permissions.`,
      );
    }
    throw error;
  }
}

/**
 * True when `child` is `parent` or lives beneath it. Compares with a trailing
 * separator so `/ws-evil` is not treated as inside `/ws`. Both arguments must
 * already be absolute; callers that handle untrusted input should pass
 * realpath-resolved values (see {@link assertContained}).
 */
export function isContained(child: string, parent: string): boolean {
  const normalizedParent = path.resolve(parent);
  const normalizedChild = path.resolve(child);
  if (normalizedChild === normalizedParent) return true;
  const prefix = normalizedParent.endsWith(path.sep)
    ? normalizedParent
    : normalizedParent + path.sep;
  return normalizedChild.startsWith(prefix);
}

/**
 * Canonicalize `child` and `parent` and assert containment. Used before any
 * filesystem or Git operation on a path derived from stored metadata, so a
 * moved or symlinked repository can never be acted on outside the workspace.
 */
export async function assertContained(child: string, parent: string): Promise<string> {
  let realChild: string;
  let realParent: string;
  try {
    realParent = await fs.realpath(parent);
  } catch {
    realParent = path.resolve(parent);
  }
  try {
    realChild = await fs.realpath(child);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      throw new DevAtlasError('REPOSITORY_UNAVAILABLE', `Path no longer exists: ${child}`);
    }
    throw error;
  }

  if (!isContained(realChild, realParent)) {
    throw new DevAtlasError(
      'PATH_ESCAPES_WORKSPACE',
      'Refusing to operate on a path outside the workspace.',
    );
  }
  return realChild;
}

/** Workspace-relative POSIX-style path used as a stable repository key. */
export function toRelativePath(root: string, absolute: string): string {
  const relative = path.relative(root, absolute);
  if (relative === '') return '.';
  return relative.split(path.sep).join('/');
}
