import path from 'node:path';

import { DevAtlasError } from '@/lib/errors';
import { requireConfig } from '@/lib/workspace/service';
import { readData } from '@/lib/workspace/store';
import type { WorkspaceConfig, WorkspaceData } from '@/types';

/**
 * The workspace this server instance manages.
 *
 * The CLI passes it as DEVATLAS_WORKSPACE_ROOT when it spawns the server, so
 * the browser can never choose which directory is being operated on — there is
 * no code path that accepts a filesystem path from a request. `npm run dev`
 * falls back to the current working directory for local development.
 */
export function activeWorkspaceRoot(): string {
  const configured = process.env.DEVATLAS_WORKSPACE_ROOT;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return process.cwd();
}

export interface ActiveWorkspace {
  root: string;
  config: WorkspaceConfig;
  data: WorkspaceData;
}

/** Load the active workspace, or throw NOT_INITIALIZED / INVALID_CONFIG. */
export async function loadActiveWorkspace(): Promise<ActiveWorkspace> {
  const root = activeWorkspaceRoot();
  const config = await requireConfig(root);
  const data = await readData(root);
  return { root, config, data };
}

/** Guard against a workspace id mismatch, e.g. a stale browser tab. */
export function assertWorkspace(config: WorkspaceConfig, expected: string | null): void {
  if (expected && expected !== config.workspaceId) {
    throw new DevAtlasError('FORBIDDEN', 'This request targets a different workspace.');
  }
}
