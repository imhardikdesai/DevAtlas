import { guardRequest } from '@/lib/security/guard';
import { failure, ok } from '@/lib/security/responses';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import {
  findRepository,
  groupIdForRepository,
  readRepositoryState,
} from '@/lib/workspace/service';
import type { RepositoryView } from '@/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    guardRequest(request);
    const { id } = await context.params;
    const { root, data } = await loadActiveWorkspace();

    const record = findRepository(data, id);
    const state = await readRepositoryState(root, record, { force: true });
    const groupId = groupIdForRepository(data, record.id);
    const group = data.groups.find((g) => g.id === groupId);

    const repository: RepositoryView = {
      id: record.id,
      name: record.name,
      absolutePath: record.absolutePath,
      relativePath: record.relativePath,
      available: record.available && !state.problem,
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      ...state,
    };

    return ok({ repository });
  } catch (error) {
    return failure(error);
  }
}
