'use client';

import { useCallback, useMemo, useState } from 'react';

import { DeleteGroupDialog, GroupFormDialog } from '@/components/groups/group-dialogs';
import { ALL_REPOSITORIES, Sidebar, UNGROUPED } from '@/components/layout/sidebar';
import { RepositoryPanel } from '@/components/repositories/repository-panel';
import { RepositoryTable } from '@/components/repositories/repository-table';
import { Button, EmptyState, Spinner, TextInput } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { WorkspaceHeader } from '@/components/workspace/workspace-header';
import { ApiError, api } from '@/lib/client/api';
import { useWorkspace } from '@/lib/client/use-workspace';
import type { GroupRecord, RepositoryView } from '@/types';

type GroupDialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; group: GroupRecord }
  | { kind: 'delete'; group: GroupRecord };

export function Dashboard() {
  const workspaceState = useWorkspace();
  const { workspace, repositories, groups, loading, refreshing, error } = workspaceState;
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>(ALL_REPOSITORIES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>({ kind: 'none' });
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const scoped = useMemo(() => {
    if (selectedGroupId === ALL_REPOSITORIES) return repositories;
    if (selectedGroupId === UNGROUPED) return repositories.filter((r) => r.groupId === null);
    return repositories.filter((r) => r.groupId === selectedGroupId);
  }, [repositories, selectedGroupId]);

  /** Search matches repository names and workspace-relative paths. */
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return scoped;
    return scoped.filter(
      (repository) =>
        repository.name.toLocaleLowerCase().includes(needle) ||
        repository.relativePath.toLocaleLowerCase().includes(needle),
    );
  }, [scoped, query]);

  const selected = useMemo(
    () => repositories.find((repository) => repository.id === selectedId) ?? null,
    [repositories, selectedId],
  );

  const assign = useCallback(
    async (repository: RepositoryView, groupId: string | null) => {
      try {
        const { groups: updated } = await api.assign(repository.id, groupId);
        workspaceState.setGroups(updated);
        await workspaceState.reload();
        const target = updated.find((group) => group.id === groupId);
        toast.push({
          tone: 'success',
          title: target
            ? `Moved ${repository.name} to ${target.name}.`
            : `Removed ${repository.name} from its group.`,
        });
      } catch (err) {
        const apiError = err instanceof ApiError ? err : null;
        toast.push({
          tone: 'error',
          title: apiError?.message ?? 'Could not change the group assignment.',
          detail: apiError?.detail,
        });
      }
    },
    [toast, workspaceState],
  );

  const submitGroup = useCallback(
    async (name: string) => {
      setGroupBusy(true);
      setGroupError(null);
      try {
        if (groupDialog.kind === 'create') {
          const { groups: updated, group } = await api.createGroup(name);
          workspaceState.setGroups(updated);
          setGroupDialog({ kind: 'none' });
          toast.push({ tone: 'success', title: `Created group “${group.name}”.` });
        } else if (groupDialog.kind === 'rename') {
          const { groups: updated, group } = await api.renameGroup(groupDialog.group.id, name);
          workspaceState.setGroups(updated);
          setGroupDialog({ kind: 'none' });
          toast.push({ tone: 'success', title: `Renamed group to “${group.name}”.` });
        }
        await workspaceState.reload();
      } catch (err) {
        setGroupError(err instanceof ApiError ? err.message : 'Could not save the group.');
      } finally {
        setGroupBusy(false);
      }
    },
    [groupDialog, toast, workspaceState],
  );

  const confirmDeleteGroup = useCallback(async () => {
    if (groupDialog.kind !== 'delete') return;
    setGroupBusy(true);
    try {
      const { groups: updated, released } = await api.deleteGroup(groupDialog.group.id);
      workspaceState.setGroups(updated);
      if (selectedGroupId === groupDialog.group.id) setSelectedGroupId(ALL_REPOSITORIES);
      setGroupDialog({ kind: 'none' });
      await workspaceState.reload();
      toast.push({
        tone: 'success',
        title: `Deleted “${groupDialog.group.name}”.`,
        detail:
          released > 0
            ? `${released} ${released === 1 ? 'repository' : 'repositories'} moved to Ungrouped.`
            : undefined,
      });
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      toast.push({
        tone: 'error',
        title: apiError?.message ?? 'Could not delete the group.',
        detail: apiError?.detail,
      });
    } finally {
      setGroupBusy(false);
    }
  }, [groupDialog, selectedGroupId, toast, workspaceState]);

  const refresh = useCallback(async () => {
    const result = await workspaceState.rediscover();
    if (!result) return;
    const parts: string[] = [];
    if (result.added > 0) parts.push(`${result.added} new`);
    if (result.removed > 0) parts.push(`${result.removed} no longer found`);
    toast.push({
      tone: 'success',
      title: parts.length > 0 ? `Workspace rescanned: ${parts.join(', ')}.` : 'Workspace rescanned.',
    });
  }, [toast, workspaceState]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Reading your workspace…" />
      </div>
    );
  }

  if (error && !workspace) {
    return <FatalError error={error} onRetry={() => void workspaceState.reload()} />;
  }

  const activeGroup = groups.find((group) => group.id === selectedGroupId);
  const emptyVariant =
    repositories.length === 0
      ? 'no-repositories'
      : query.trim()
        ? 'no-results'
        : scoped.length === 0
          ? 'empty-group'
          : 'no-results';

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        workspace={workspace}
        groups={groups}
        repositories={repositories}
        selectedGroupId={selectedGroupId}
        onSelectGroup={setSelectedGroupId}
        onCreateGroup={() => {
          setGroupError(null);
          setGroupDialog({ kind: 'create' });
        }}
        onRenameGroup={(group) => {
          setGroupError(null);
          setGroupDialog({ kind: 'rename', group });
        }}
        onDeleteGroup={(group) => setGroupDialog({ kind: 'delete', group })}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceHeader
          workspace={workspace}
          repositoryCount={repositories.length}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          onRenamed={workspaceState.setWorkspace}
        />

        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          <main className="min-w-0 flex-1 px-5 py-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">
                  {selectedGroupId === ALL_REPOSITORIES
                    ? 'All repositories'
                    : selectedGroupId === UNGROUPED
                      ? 'Ungrouped'
                      : (activeGroup?.name ?? 'Group')}
                </h2>
                <p className="text-xs text-ink-faint">
                  Showing {visible.length} of {scoped.length}
                </p>
              </div>
              <div className="w-full max-w-sm">
                <label htmlFor="repository-search" className="sr-only">
                  Search repositories by name or path
                </label>
                <TextInput
                  id="repository-search"
                  type="search"
                  value={query}
                  placeholder="Search by name or path…"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            {error ? (
              <p className="mb-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
                {error.message}
              </p>
            ) : null}

            <RepositoryTable
              repositories={visible}
              groups={groups}
              selectedId={selectedId}
              query={query}
              onSelect={(repository) => setSelectedId(repository.id)}
              onAssign={(repository, groupId) => void assign(repository, groupId)}
              onClearSearch={() => setQuery('')}
              emptyVariant={emptyVariant}
              groupName={activeGroup?.name}
            />
          </main>

          {selected ? (
            <RepositoryPanel
              key={selected.id}
              repository={selected}
              groups={groups}
              onClose={() => setSelectedId(null)}
              onAssign={(repository, groupId) => void assign(repository, groupId)}
              onChanged={() => void workspaceState.reload()}
            />
          ) : null}
        </div>
      </div>

      {groupDialog.kind === 'create' || groupDialog.kind === 'rename' ? (
        <GroupFormDialog
          // Keying on the target remounts the form for each use, so it starts
          // from the right name without resetting itself in an effect.
          key={groupDialog.kind === 'rename' ? groupDialog.group.id : 'create'}
          open
          mode={groupDialog.kind === 'rename' ? 'rename' : 'create'}
          initialName={groupDialog.kind === 'rename' ? groupDialog.group.name : ''}
          busy={groupBusy}
          error={groupError}
          onSubmit={(name) => void submitGroup(name)}
          onCancel={() => setGroupDialog({ kind: 'none' })}
        />
      ) : null}

      <DeleteGroupDialog
        open={groupDialog.kind === 'delete'}
        group={groupDialog.kind === 'delete' ? groupDialog.group : null}
        repositoryCount={
          groupDialog.kind === 'delete'
            ? repositories.filter((r) => r.groupId === groupDialog.group.id).length
            : 0
        }
        busy={groupBusy}
        onConfirm={() => void confirmDeleteGroup()}
        onCancel={() => setGroupDialog({ kind: 'none' })}
      />
    </div>
  );
}

/** Whole-app failure states: these are the only reasons the dashboard cannot render. */
function FatalError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const content = describeFatal(error);
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-xl">
        <EmptyState
          glyph="!"
          title={content.title}
          body={
            <div className="flex flex-col gap-3 text-left">
              <p className="leading-relaxed">{content.body}</p>
              {content.command ? (
                <code className="block rounded-md border border-edge bg-raised px-3 py-2 font-mono text-xs">
                  {content.command}
                </code>
              ) : null}
              {error.detail ? (
                <p className="font-mono text-xs break-words text-ink-faint">{error.detail}</p>
              ) : null}
            </div>
          }
          action={<Button onClick={onRetry}>Try again</Button>}
        />
      </div>
    </div>
  );
}

function describeFatal(error: ApiError): { title: string; body: string; command?: string } {
  switch (error.code) {
    case 'NOT_INITIALIZED':
      return {
        title: 'This folder is not a DevAtlas workspace',
        body: 'DevAtlas could not find a .devatlas directory for the folder it was started in. Initialize it from your terminal, then reload this page.',
        command: 'devatlas init /path/to/your/workspace',
      };
    case 'INVALID_CONFIG':
      return {
        title: 'The workspace configuration could not be read',
        body: 'DevAtlas has not changed any of your files. Open the .devatlas folder in your workspace, fix or remove the file named below, then reload.',
      };
    case 'GIT_MISSING':
      return {
        title: 'Git is not installed',
        body: 'DevAtlas needs the git command to read your repositories. Install Git, make sure `git --version` works in your terminal, then reload this page.',
        command: 'git --version',
      };
    default:
      return {
        title: 'DevAtlas could not load this workspace',
        body: error.message,
      };
  }
}
