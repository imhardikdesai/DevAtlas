'use client';

import { Button, Modal } from '@/components/ui/primitives';
import { describeStatus } from '@/lib/client/status';
import type { BranchInfo, WorkingTreeStatus } from '@/types';

export interface DirtySwitchDialogProps {
  open: boolean;
  repositoryName: string;
  branch: BranchInfo | null;
  status: WorkingTreeStatus | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation shown when the working tree has uncommitted changes.
 *
 * The wording is deliberate: DevAtlas does not discard, stash or commit
 * anything, and `git switch` carries changes across when it can. What it cannot
 * promise is that the switch will succeed — Git refuses when local changes
 * would be overwritten. The dialog says exactly that, and nothing stronger.
 */
export function DirtySwitchDialog({
  open,
  repositoryName,
  branch,
  status,
  busy,
  onConfirm,
  onCancel,
}: DirtySwitchDialogProps) {
  const presentation = status ? describeStatus(status) : null;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="This repository has uncommitted changes"
      description={
        <>
          <span className="font-medium text-ink">{repositoryName}</span> has changes that are not
          committed. DevAtlas will not discard, stash or commit them.
        </>
      }
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Switching…' : `Switch to ${branch?.name ?? 'branch'}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {presentation ? (
          <p className="rounded-md border border-edge bg-raised px-3 py-2">
            <span aria-hidden className="mr-1.5">
              {presentation.glyph}
            </span>
            {presentation.description}
          </p>
        ) : null}

        <p className="leading-relaxed text-ink-muted">
          Git will try to carry your changes over to{' '}
          <span className="font-mono text-ink">{branch?.name}</span>. If those changes conflict
          with that branch, <strong className="font-medium text-ink">Git will refuse</strong> the
          switch and leave this repository exactly as it is now.
        </p>

        {branch?.remoteOnlyLocalName ? (
          <p className="rounded-md border border-caution/30 bg-caution-soft px-3 py-2 leading-relaxed">
            This is a remote branch. Continuing also creates a local branch named{' '}
            <span className="font-mono">{branch.remoteOnlyLocalName}</span> that tracks it.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
