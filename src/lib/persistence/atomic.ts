import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { errnoCode } from '@/lib/errors';

/**
 * Per-path promise chain. Concurrent writers to the same file are serialized so
 * a read-modify-write cycle can never interleave with another one in-process.
 */
const locks = new Map<string, Promise<unknown>>();

export function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Keep the chain alive but never let a rejection poison later writers.
  locks.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/**
 * Write `contents` to `filePath` atomically: a temp file in the same directory
 * is written and fsync'd, then renamed over the target. rename(2) is atomic
 * within a filesystem on macOS, Linux and Windows, so a crash mid-write leaves
 * the previous file fully intact rather than a truncated one.
 */
export async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${randomBytes(6).toString('hex')}`);

  await fs.mkdir(dir, { recursive: true });

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, 'w');
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle?.close();
  }

  try {
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Read a UTF-8 file, returning undefined when it simply does not exist. */
export async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}
