'use client';

import { useEffect, useRef, useState } from 'react';

import { ApiError, api } from '@/lib/client/api';
import { Button, PathText, Spinner, TextInput } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import type { WorkspaceView } from '@/types';

export interface WorkspaceHeaderProps {
  workspace: WorkspaceView | null;
  repositoryCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  onRenamed: (workspace: WorkspaceView) => void;
}

/**
 * Workspace name, root path and repository count, with inline renaming.
 *
 * Renaming changes the stored display name only. The workspace directory on
 * disk is never renamed — the path shown below the name stays exactly as it is.
 */
export function WorkspaceHeader({
  workspace,
  repositoryCount,
  refreshing,
  onRefresh,
  onRenamed,
}: WorkspaceHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function beginEdit() {
    setValue(workspace?.name ?? '');
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Enter a name with at least one non-space character.');
      return;
    }
    if (trimmed === workspace?.name) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const { workspace: updated } = await api.renameWorkspace(trimmed);
      onRenamed(updated);
      setEditing(false);
      toast.push({ tone: 'success', title: `Workspace renamed to “${updated.name}”.` });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not rename the workspace.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-edge bg-surface px-5 py-4">
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex max-w-md flex-col gap-2">
            <div className="flex items-center gap-2">
              <TextInput
                ref={inputRef}
                value={value}
                aria-label="Workspace name"
                aria-invalid={error ? 'true' : undefined}
                disabled={saving}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save();
                  if (event.key === 'Escape') setEditing(false);
                }}
              />
              <Button variant="primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : (
              <p className="text-xs text-ink-faint">
                This changes the name DevAtlas shows. The folder on disk is not renamed.
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {workspace?.name ?? 'DevAtlas'}
            </h1>
            <button
              type="button"
              onClick={beginEdit}
              disabled={!workspace}
              className="rounded px-1.5 py-0.5 text-sm text-ink-faint hover:bg-raised hover:text-ink disabled:opacity-40"
              aria-label="Rename workspace"
              title="Rename workspace"
            >
              <span aria-hidden>✎</span>
            </button>
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <PathText value={workspace?.rootPath ?? ''} className="max-w-xl text-ink-muted" />
          <span aria-hidden className="text-ink-faint">
            ·
          </span>
          <span className="tabular-nums">
            {repositoryCount} {repositoryCount === 1 ? 'repository' : 'repositories'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {refreshing ? <Spinner label="Scanning…" /> : null}
        <Button onClick={onRefresh} disabled={refreshing}>
          Refresh
        </Button>
      </div>
    </header>
  );
}
