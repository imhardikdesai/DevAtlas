'use client';

import { Button, cx } from '@/components/ui/primitives';
import type { GroupRecord, RepositoryView, WorkspaceView } from '@/types';

export const UNGROUPED = '__ungrouped__';
export const ALL_REPOSITORIES = '__all__';

export interface SidebarProps {
  workspace: WorkspaceView | null;
  groups: GroupRecord[];
  repositories: RepositoryView[];
  selectedGroupId: string;
  onSelectGroup: (id: string) => void;
  onCreateGroup: () => void;
  onRenameGroup: (group: GroupRecord) => void;
  onDeleteGroup: (group: GroupRecord) => void;
}

export function Sidebar({
  workspace,
  groups,
  repositories,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
}: SidebarProps) {
  const countFor = (groupId: string) =>
    groupId === ALL_REPOSITORIES
      ? repositories.length
      : groupId === UNGROUPED
        ? repositories.filter((r) => r.groupId === null).length
        : repositories.filter((r) => r.groupId === groupId).length;

  return (
    <aside className="flex h-full w-full flex-col gap-6 border-edge bg-surface px-4 py-5 md:w-72 md:border-r">
      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-md bg-accent text-sm font-bold text-white"
          >
            DA
          </span>
          <span className="text-base font-semibold tracking-tight">DevAtlas</span>
        </div>
        <p className="mt-3 text-xs font-medium tracking-wide text-ink-faint uppercase">
          Workspace
        </p>
        <p className="truncate text-sm font-medium text-ink" title={workspace?.name}>
          {workspace?.name ?? '—'}
        </p>
      </div>

      <nav aria-label="Workspace sections" className="flex flex-col gap-1">
        <p className="px-2 pb-1 text-xs font-medium tracking-wide text-ink-faint uppercase">
          Repositories
        </p>
        <SidebarItem
          label="All repositories"
          count={countFor(ALL_REPOSITORIES)}
          active={selectedGroupId === ALL_REPOSITORIES}
          onClick={() => onSelectGroup(ALL_REPOSITORIES)}
        />
        <SidebarItem
          label="Ungrouped"
          count={countFor(UNGROUPED)}
          active={selectedGroupId === UNGROUPED}
          onClick={() => onSelectGroup(UNGROUPED)}
        />
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between px-2 pb-1">
          <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">Groups</p>
          <button
            type="button"
            onClick={onCreateGroup}
            className="rounded px-1.5 text-sm text-ink-muted hover:bg-raised hover:text-ink"
            aria-label="Create a group"
            title="Create a group"
          >
            +
          </button>
        </div>

        {groups.length === 0 ? (
          <p className="px-2 text-xs leading-relaxed text-ink-faint">
            No groups yet. Create one to organize repositories by area, for example Frontend or
            Infrastructure.
          </p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {groups.map((group) => (
              <li key={group.id} className="group/item">
                <SidebarItem
                  label={group.name}
                  count={countFor(group.id)}
                  active={selectedGroupId === group.id}
                  onClick={() => onSelectGroup(group.id)}
                  actions={
                    <>
                      <IconAction
                        label={`Rename group ${group.name}`}
                        glyph="✎"
                        onClick={() => onRenameGroup(group)}
                      />
                      <IconAction
                        label={`Delete group ${group.name}`}
                        glyph="🗑"
                        onClick={() => onDeleteGroup(group)}
                      />
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        )}

        <Button variant="secondary" onClick={onCreateGroup} className="mt-2 w-full">
          New group
        </Button>
      </div>
    </aside>
  );
}

function SidebarItem({
  label,
  count,
  active,
  onClick,
  actions,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        'flex items-center gap-1 rounded-md pr-1',
        active ? 'bg-accent-soft' : 'hover:bg-raised',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pl-2 text-left text-sm"
      >
        <span className={cx('truncate', active ? 'font-medium text-ink' : 'text-ink-muted')}>
          {label}
        </span>
        <span
          className={cx(
            'ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-xs tabular-nums',
            active ? 'bg-surface text-ink' : 'bg-raised text-ink-faint',
          )}
        >
          {count}
        </span>
      </button>
      {actions ? (
        <span className="flex shrink-0 items-center gap-0.5">{actions}</span>
      ) : null}
    </div>
  );
}

function IconAction({
  label,
  glyph,
  onClick,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded px-1 py-1 text-xs text-ink-faint hover:bg-surface hover:text-ink"
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );
}
