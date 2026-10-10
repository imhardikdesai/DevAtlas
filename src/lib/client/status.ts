import type { HeadState, RepositoryView, WorkingTreeStatus } from '@/types';

export type StatusTone = 'clean' | 'dirty' | 'conflict' | 'unknown';

export interface StatusPresentation {
  tone: StatusTone;
  /** Short label, e.g. "Clean" or "2 staged, 1 untracked". */
  label: string;
  /** Longer sentence for tooltips and the detail panel. */
  description: string;
  /**
   * A text/shape marker shown next to the label. Status is never communicated
   * by colour alone — the glyph and the words carry the same information.
   */
  glyph: string;
}

export function describeStatus(
  status: WorkingTreeStatus | null,
  problem?: RepositoryView['problem'],
): StatusPresentation {
  if (problem) {
    return {
      tone: 'unknown',
      glyph: '!',
      label: problemLabel(problem),
      description: problemDescription(problem),
    };
  }
  if (!status) {
    return {
      tone: 'unknown',
      glyph: '?',
      label: 'Unknown',
      description: 'DevAtlas could not read this repository’s working tree.',
    };
  }
  if (status.conflicted > 0) {
    return {
      tone: 'conflict',
      glyph: '✕',
      label: `${status.conflicted} conflicted`,
      description: `${plural(status.conflicted, 'file has', 'files have')} unresolved merge conflicts.`,
    };
  }
  if (status.clean) {
    return {
      tone: 'clean',
      glyph: '✓',
      label: 'Clean',
      description: 'No uncommitted changes.',
    };
  }

  const parts: string[] = [];
  if (status.staged > 0) parts.push(`${status.staged} staged`);
  if (status.unstaged > 0) parts.push(`${status.unstaged} unstaged`);
  if (status.untracked > 0) parts.push(`${status.untracked} untracked`);

  return {
    tone: 'dirty',
    glyph: '●',
    label: parts.join(', ') || 'Modified',
    description: `This repository has uncommitted changes: ${parts.join(', ')}.`,
  };
}

function problemLabel(problem: NonNullable<RepositoryView['problem']>): string {
  switch (problem) {
    case 'missing':
      return 'Missing';
    case 'inaccessible':
      return 'Inaccessible';
    case 'not-a-repository':
      return 'Not a repository';
    case 'git-error':
      return 'Git error';
  }
}

function problemDescription(problem: NonNullable<RepositoryView['problem']>): string {
  switch (problem) {
    case 'missing':
      return 'This directory no longer exists. Its group assignment has been kept in case it comes back.';
    case 'inaccessible':
      return 'DevAtlas does not have permission to read this directory.';
    case 'not-a-repository':
      return 'This directory is no longer a Git repository.';
    case 'git-error':
      return 'Git reported an error while reading this repository.';
  }
}

export function describeHead(head: HeadState | null): { label: string; note?: string } {
  if (!head) return { label: 'Unknown' };
  switch (head.kind) {
    case 'branch':
      return { label: head.branch ?? 'Unknown' };
    case 'unborn':
      return { label: head.branch ?? 'Unknown', note: 'No commits yet' };
    case 'detached':
      return { label: head.commit ?? 'detached', note: 'Detached HEAD' };
    case 'unknown':
      return { label: 'Unknown' };
  }
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export const toneClasses: Record<StatusTone, string> = {
  clean: 'text-positive bg-positive-soft border-positive/25',
  dirty: 'text-caution bg-caution-soft border-caution/25',
  conflict: 'text-danger bg-danger-soft border-danger/25',
  unknown: 'text-ink-muted bg-raised border-edge',
};
