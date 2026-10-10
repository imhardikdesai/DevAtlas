import { guardRequest } from '@/lib/security/guard';
import { failure, ok } from '@/lib/security/responses';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import { findRepository, readBranches } from '@/lib/workspace/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    guardRequest(request);
    const { id } = await context.params;
    const { root, data } = await loadActiveWorkspace();
    const record = findRepository(data, id);
    const branches = await readBranches(root, record);
    return ok({ branches });
  } catch (error) {
    return failure(error);
  }
}
