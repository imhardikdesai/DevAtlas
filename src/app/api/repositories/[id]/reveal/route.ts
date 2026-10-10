import { execFile } from 'node:child_process';

import { assertContained } from '@/lib/config/paths';
import { DevAtlasError } from '@/lib/errors';
import { guardRequest } from '@/lib/security/guard';
import { failure, ok } from '@/lib/security/responses';
import { loadActiveWorkspace } from '@/lib/workspace/active';
import { findRepository } from '@/lib/workspace/service';

export const dynamic = 'force-dynamic';

/**
 * Reveal a repository in the platform file manager.
 *
 * The path comes from stored metadata resolved by repository id and is
 * re-verified to be inside the workspace — a request can never name a path.
 * The opener is invoked with an argument array, never a shell string.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    guardRequest(request);
    const { id } = await context.params;
    const { root, data } = await loadActiveWorkspace();

    const record = findRepository(data, id);
    const safePath = await assertContained(record.absolutePath, root);

    // Literal command names per platform — nothing here is derived from the
    // request, and the path is passed as an argument, never interpolated.
    await new Promise<void>((resolve, reject) => {
      const done = (error: Error | null) => {
        // Windows explorer.exe exits non-zero even on success.
        if (error && process.platform !== 'win32') reject(error);
        else resolve();
      };
      if (process.platform === 'darwin') {
        execFile('open', [safePath], { windowsHide: true }, done);
      } else if (process.platform === 'win32') {
        execFile('explorer.exe', [safePath], { windowsHide: true }, done);
      } else {
        execFile('xdg-open', [safePath], { windowsHide: true }, done);
      }
    });

    return ok({ revealed: true, path: safePath });
  } catch (error) {
    if (error instanceof Error && !(error as { code?: unknown }).code) {
      return failure(error);
    }
    return failure(
      new DevAtlasError('INTERNAL', 'Could not open the system file manager.', {
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
