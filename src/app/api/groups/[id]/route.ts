import { guardRequest } from '@/lib/security/guard';
import { failure, ok, readJson } from '@/lib/security/responses';
import { updateGroupSchema } from '@/lib/validation/schemas';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import { deleteGroup, renameGroup } from '@/lib/workspace/service';
import { readData } from '@/lib/workspace/store';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    guardRequest(request);
    const { id } = await context.params;
    const { root } = await loadActiveWorkspace();
    const input = updateGroupSchema.parse(await readJson(request));
    const group = await renameGroup(root, id, input.name);
    const data = await readData(root);
    return ok({ group, groups: data.groups });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Delete a group. Its repositories become Ungrouped — no repository record is
 * removed and nothing on disk is touched.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    guardRequest(request);
    const { id } = await context.params;
    const { root } = await loadActiveWorkspace();
    const { released } = await deleteGroup(root, id);
    const data = await readData(root);
    return ok({ deleted: true, released, groups: data.groups });
  } catch (error) {
    return failure(error);
  }
}
