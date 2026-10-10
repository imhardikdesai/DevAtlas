import { guardRequest } from '@/lib/security/guard';
import { failure, ok, readJson } from '@/lib/security/responses';
import { createGroupSchema } from '@/lib/validation/schemas';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import { createGroup } from '@/lib/workspace/service';
import { readData } from '@/lib/workspace/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    guardRequest(request);
    const { data } = await loadActiveWorkspace();
    return ok({ groups: data.groups });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    guardRequest(request);
    const { root } = await loadActiveWorkspace();
    const input = createGroupSchema.parse(await readJson(request));
    const group = await createGroup(root, input.name);
    const data = await readData(root);
    return ok({ group, groups: data.groups }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
