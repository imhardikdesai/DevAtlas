import { guardRequest } from '@/lib/security/guard';
import { failure, ok, readJson } from '@/lib/security/responses';
import { assignRepositorySchema } from '@/lib/validation/schemas';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import { assignRepository } from '@/lib/workspace/service';

export const dynamic = 'force-dynamic';

/** Move a repository into a group, or out of every group when groupId is null. */
export async function PATCH(request: Request) {
  try {
    guardRequest(request);
    const { root } = await loadActiveWorkspace();
    const input = assignRepositorySchema.parse(await readJson(request));
    const data = await assignRepository(root, input.repositoryId, input.groupId);
    return ok({ groups: data.groups });
  } catch (error) {
    return failure(error);
  }
}
