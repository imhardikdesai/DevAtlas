'use client';

import { BranchLabel, StatusBadge } from '@/components/repositories/status-badge';
import { Button, EmptyState, PathText, cx } from '@/components/ui/primitives';
import type { GroupRecord, RepositoryView } from '@/types';

export interface RepositoryTableProps {
  repositories: RepositoryView[];
  groups: GroupRecord[];
  selectedId: string | null;
  query: string;
  onSelect: (repository: RepositoryView) => void;
  onAssign: (repository: RepositoryView, groupId: string | null) => void;
  onClearSearch: () => void;
  emptyVariant: 'no-repositories' | 'no-results' | 'empty-group';
  groupName?: string;
}

export function RepositoryTable({
  repositories,
  groups,
  selectedId,
  query,
  onSelect,
  onAssign,
  onClearSearch,
  emptyVariant,
  groupName,
}: RepositoryTableProps) {
  if (repositories.length === 0) {
    return <RepositoryEmptyState variant={emptyVariant} query={query} groupName={groupName} onClearSearch={onClearSearch} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-surface">
      <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
        <caption className="sr-only">
          Repositories in this workspace, with branch, working-tree status and group.
        </caption>
        <thead>
          <tr className="border-b border-edge bg-raised text-xs tracking-wide text-ink-muted uppercase">
            <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">
              Repository
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
              Path
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Branch
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
              Group
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {repositories.map((repository) => (
            <tr
              key={repository.id}
              className={cx(
                'border-b border-edge last:border-b-0',
                selectedId === repository.id ? 'bg-accent-soft' : 'hover:bg-raised',
              )}
            >
              <td className="px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => onSelect(repository)}
                  className="text-left font-medium whitespace-nowrap text-ink hover:text-accent hover:underline"
                >
                  {repository.name}
                </button>
                {!repository.available ? (
                  <span className="ml-2 rounded border border-edge bg-raised px-1.5 py-0.5 text-xs text-ink-muted">
                    Unavailable
                  </span>
                ) : null}
                <PathText
                  value={repository.relativePath}
                  className="mt-0.5 max-w-[18rem] text-ink-faint lg:hidden"
                />
              </td>
              <td className="hidden max-w-[20rem] px-4 py-2.5 lg:table-cell">
                <PathText value={repository.relativePath} className="text-ink-muted" />
              </td>
              <td className="min-w-[11rem] px-4 py-2.5">
                <BranchLabel head={repository.head} />
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={repository.status} problem={repository.problem} />
              </td>
              <td className="hidden px-4 py-2.5 sm:table-cell">
                <label className="sr-only" htmlFor={`group-${repository.id}`}>
                  Group for {repository.name}
                </label>
                <select
                  id={`group-${repository.id}`}
                  value={repository.groupId ?? ''}
                  onChange={(event) => onAssign(repository, event.target.value || null)}
                  className="max-w-[11rem] truncate rounded-md border border-edge bg-surface px-2 py-1 text-sm text-ink"
                >
                  <option value="">Ungrouped</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-2.5 text-right">
                <Button variant="ghost" onClick={() => onSelect(repository)}>
                  Details
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepositoryEmptyState({
  variant,
  query,
  groupName,
  onClearSearch,
}: {
  variant: RepositoryTableProps['emptyVariant'];
  query: string;
  groupName?: string;
  onClearSearch: () => void;
}) {
  if (variant === 'no-results') {
    return (
      <EmptyState
        glyph="⌕"
        title="No repositories match your search"
        body={
          <>
            Nothing in this workspace matches <span className="font-mono">“{query}”</span>. Search
            looks at both repository names and their paths.
          </>
        }
        action={
          <Button onClick={onClearSearch} variant="secondary">
            Clear search
          </Button>
        }
      />
    );
  }

  if (variant === 'empty-group') {
    return (
      <EmptyState
        glyph="▢"
        title={`${groupName ?? 'This group'} has no repositories yet`}
        body="Assign repositories to this group from the Group column in All repositories, or from a repository's detail panel."
      />
    );
  }

  return (
    <EmptyState
      glyph="◌"
      title="No Git repositories found"
      body="DevAtlas did not find any Git repositories inside this workspace. Clone or create one below the workspace folder, then choose Refresh."
    />
  );
}
