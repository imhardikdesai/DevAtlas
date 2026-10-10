import { guardRequest } from '@/lib/security/guard';
import { failure, ok, readJson } from '@/lib/security/responses';
import { switchBranchSchema } from '@/lib/validation/schemas';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import { findRepository, performSwitch, readRepositoryState } from '@/lib/workspace/service';

export const dynamic = 'force-dynamic';

/**
 * Switch a repository to another branch.
 *
 * The repository is addressed by id only — the browser never supplies a path.
 * A dirty working tree returns `outcome: "needs-confirmation"` with the live
 * status so the UI can ask; the client must resend with confirmDirty to
 * proceed. Even then, nothing is discarded: if Git refuses because local
 * changes would be overwritten, the refusal is reported verbatim and the
 * working tree is left exactly as it was.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    guardRequest(request);
    const { id } = await context.params;
    const { root, data } = await loadActiveWorkspace();

    const record = findRepository(data, id);
    const input = switchBranchSchema.parse(await readJson(request));

    const result = await performSwitch(root, record, {
      branch: input.branch,
      kind: input.kind,
      confirmDirty: input.confirmDirty,
    });

    if (result.outcome === 'needs-confirmation') {
      return ok({ outcome: 'needs-confirmation', status: result.status });
    }

    // Return the post-operation state so the dashboard reflects reality rather
    // than an assumption about what the switch did.
    const state = await readRepositoryState(root, record, { force: true });

    return ok({
      outcome: 'switched',
      branches: result.listing,
      status: result.status,
      createdTrackingBranch: result.createdTrackingBranch ?? null,
      head: state.head,
    });
  } catch (error) {
    return failure(error);
  }
}
