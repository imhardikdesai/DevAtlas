import { guardRequest } from '@/lib/security/guard';
import { failure, ok } from '@/lib/security/responses';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import { listRepositoryViews, refreshRepositories, toWorkspaceView } from '@/lib/workspace/service';

export const dynamic = 'force-dynamic';

/**
 * Re-walk the workspace and fold the result into stored metadata.
 *
 * The merge is additive: repositories that disappeared are retained as
 * unavailable so their group assignment survives, and existing ids are kept so
 * nothing is re-created under a new identity.
 */
export async function POST(request: Request) {
  try {
    guardRequest(request);
    const { root, config } = await loadActiveWorkspace();
    const { data, added, removed, warnings } = await refreshRepositories(root);
    const repositories = await listRepositoryViews(root, data, { force: true });

    return ok({
      workspace: toWorkspaceView(config, data.repositories.length),
      repositories,
      groups: data.groups,
      discovery: { added, removed, warnings },
    });
  } catch (error) {
    return failure(error);
  }
}
