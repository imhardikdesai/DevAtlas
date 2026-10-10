import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DevAtlasError } from '@/lib/errors';

/**
 * Locate the installed DevAtlas package directory.
 *
 * Resolution walks up from this module's own file, never from
 * `process.cwd()` — the CLI must find its packaged application no matter which
 * directory the user ran it from.
 */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));

  for (let i = 0; i < 12; i += 1) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest) && isDevAtlasManifest(manifest)) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new DevAtlasError('INTERNAL', 'Could not locate the DevAtlas package directory.', {
    detail: `Searched upwards from ${path.dirname(fileURLToPath(import.meta.url))}`,
  });
}

/**
 * Identify the package by its name rather than by where it sits.
 *
 * A globally or locally installed DevAtlas legitimately lives at
 * `node_modules/devatlas`, so "ignore anything under node_modules" would
 * reject the real install location — while matching on the name still skips
 * any unrelated manifest encountered on the way up.
 */
function isDevAtlasManifest(manifest: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { name?: unknown }).name === 'devatlas'
    );
  } catch {
    return false;
  }
}

export interface ServerEntry {
  /** Absolute path to the Next standalone server entry point. */
  script: string;
  /** Directory the server process should run in. */
  cwd: string;
}

/**
 * Find the production server built by `next build` with output: 'standalone'.
 *
 * Next writes the entry at `.next/standalone/server.js` for a root-level app,
 * or nested under the project directory name in a monorepo layout, so both are
 * checked.
 */
export function resolveServerEntry(root: string = packageRoot()): ServerEntry {
  const standalone = path.join(root, '.next', 'standalone');
  const candidates = [
    path.join(standalone, 'server.js'),
    path.join(standalone, path.basename(root), 'server.js'),
  ];

  for (const script of candidates) {
    if (existsSync(script)) return { script, cwd: path.dirname(script) };
  }

  throw new DevAtlasError(
    'SERVER_START_FAILED',
    'The DevAtlas application bundle is missing.',
    {
      detail: `Looked for ${candidates.join(' and ')}`,
    },
  );
}

/** The installed DevAtlas version, read from its own package.json. */
export function packageVersion(): string {
  const manifest = path.join(packageRoot(), 'package.json');
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string };
  if (!parsed.version) {
    throw new DevAtlasError('INTERNAL', 'package.json has no version field.');
  }
  return parsed.version;
}
