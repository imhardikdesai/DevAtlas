import { guardRequest } from '@/lib/security/guard';
import { failure, ok } from '@/lib/security/responses';
import { loadActiveWorkspace } from '@/lib/workspace/active';

export const dynamic = 'force-dynamic';

/**
 * Readiness probe. The CLI polls this and only opens a browser once it reports
 * the workspace id it just launched, which is also how a stale runtime.json
 * pointing at some other process is detected.
 */
export async function GET(request: Request) {
  try {
    guardRequest(request);
    const { config } = await loadActiveWorkspace();
    return ok({
      ok: true,
      workspaceId: config.workspaceId,
      name: config.name,
      rootPath: config.rootPath,
    });
  } catch (error) {
    return failure(error);
  }
}
