import { guardRequest } from '@/lib/security/guard';
import { failure, ok } from '@/lib/security/responses';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import { listRepositoryViews, toWorkspaceView } from '@/lib/workspace/service';

export const dynamic = 'force-dynamic';

/**
 * List every repository with live branch and working-tree status.
 *
 * `?force=1` bypasses the short status cache without re-walking the filesystem;
 * a full rediscovery is POST /api/repositories/refresh.
 */
export async function GET(request: Request) {
  try {
    guardRequest(request);
    const url = new URL(request.url);
    const force = url.searchParams.get('force') === '1';

    const { root, config, data } = await loadActiveWorkspace();
    const repositories = await listRepositoryViews(root, data, { force });

    return ok({
      workspace: toWorkspaceView(config, data.repositories.length),
      repositories,
      groups: data.groups,
    });
  } catch (error) {
    return failure(error);
  }
}
