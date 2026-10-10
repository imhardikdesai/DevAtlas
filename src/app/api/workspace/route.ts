import { guardRequest } from '@/lib/security/guard';
import { failure, ok, readJson } from '@/lib/security/responses';
import { renameWorkspaceSchema } from '@/lib/validation/schemas';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import { toWorkspaceView } from '@/lib/workspace/service';
import { renameWorkspace } from '@/lib/workspace/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    guardRequest(request);
    const { config, data } = await loadActiveWorkspace();
    return ok({ workspace: toWorkspaceView(config, data.repositories.length) });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Rename the workspace.
 *
 * This writes a display name into config.json and nothing else — the workspace
 * directory on disk is never renamed or moved.
 */
export async function PATCH(request: Request) {
  try {
    guardRequest(request);
    const { root, data } = await loadActiveWorkspace();
    const input = renameWorkspaceSchema.parse(await readJson(request));
    const config = await renameWorkspace(root, input.name);
    return ok({ workspace: toWorkspaceView(config, data.repositories.length) });
  } catch (error) {
    return failure(error);
  }
}
