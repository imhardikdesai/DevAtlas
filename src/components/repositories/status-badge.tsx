'use client';

import { cx } from '@/components/ui/primitives';
import { describeStatus, toneClasses } from '@/lib/client/status';
import type { RepositoryView, WorkingTreeStatus } from '@/types';

/**
 * Working-tree status.
 *
 * The glyph and the written label both carry the meaning, so the badge is
 * readable without relying on colour — colour only reinforces it.
 */
export function StatusBadge({
  status,
  problem,
  className,
}: {
  status: WorkingTreeStatus | null;
  problem?: RepositoryView['problem'];
  className?: string;
}) {
  const presentation = describeStatus(status, problem);

  return (
    <span
      title={presentation.description}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClasses[presentation.tone],
        className,
      )}
    >
      <span aria-hidden>{presentation.glyph}</span>
      <span>{presentation.label}</span>
    </span>
  );
}

/** Branch name with a note for detached HEAD or an unborn branch. */
export function BranchLabel({
  head,
  className,
}: {
  head: RepositoryView['head'];
  className?: string;
}) {
  if (!head) {
    return <span className={cx('text-sm text-ink-faint', className)}>—</span>;
  }

  if (head.kind === 'detached') {
    return (
      <span className={cx('inline-flex flex-wrap items-center gap-x-1.5 gap-y-1', className)}>
        <span className="font-mono text-sm">{head.commit}</span>
        <span className="rounded border border-caution/30 bg-caution-soft px-1.5 py-0.5 text-xs whitespace-nowrap text-caution">
          Detached HEAD
        </span>
      </span>
    );
  }

  if (head.kind === 'unknown') {
    return <span className={cx('text-sm text-ink-faint', className)}>Unknown</span>;
  }

  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-1.5 gap-y-1', className)}>
      <span className="max-w-full truncate font-mono text-sm">{head.branch}</span>
      {head.kind === 'unborn' ? (
        <span className="rounded border border-edge bg-raised px-1.5 py-0.5 text-xs whitespace-nowrap text-ink-muted">
          No commits yet
        </span>
      ) : null}
    </span>
  );
}
