'use client';

import { useCallback, useEffect, useState } from 'react';

import { BranchPicker } from '@/components/branches/branch-picker';
import { DirtySwitchDialog } from '@/components/branches/dirty-switch-dialog';
import { BranchLabel, StatusBadge } from '@/components/repositories/status-badge';
import { Button, PathText, Spinner, cx } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/client/api';
import { describeStatus } from '@/lib/client/status';
import type { BranchInfo, BranchListing, GroupRecord, RepositoryView } from '@/types';

export interface RepositoryPanelProps {
  repository: RepositoryView;
  groups: GroupRecord[];
  onClose: () => void;
  onAssign: (repository: RepositoryView, groupId: string | null) => void;
  /** Called after any operation that changed Git state, so the list re-reads. */
  onChanged: () => void;
}

export function RepositoryPanel({
  repository,
  groups,
  onClose,
  onAssign,
  onChanged,
}: RepositoryPanelProps) {
  const toast = useToast();

  const [listing, setListing] = useState<BranchListing | null>(null);
  // The panel is keyed by repository id, so every mount starts a fresh load.
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [branchError, setBranchError] = useState<string | null>(null);

  const [pending, setPending] = useState<BranchInfo | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<RepositoryView['status']>(null);
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Fetch the branch list. Deliberately performs no synchronous state update:
   * the first setState happens only after the request settles, so this can be
   * called straight from an effect without triggering a cascading render.
   */
  const loadBranches = useCallback(async () => {
    try {
      const { branches } = await api.branches(repository.id);
      setListing(branches);
      setBranchError(null);
    } catch (error) {
      setListing(null);
      setBranchError(
        error instanceof ApiError
          ? [error.message, error.detail].filter(Boolean).join('\n')
          : String(error),
      );
    } finally {
      setLoadingBranches(false);
    }
  }, [repository.id]);

  useEffect(() => {
    // react-hooks/set-state-in-effect follows the call graph into
    // loadBranches and flags its setState calls, but every one of them runs
    // after `await api.branches(...)` settles — nothing updates state
    // synchronously here, so there is no cascading render to avoid. Fetching
    // on mount is the intended behaviour: the panel is keyed by repository id.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBranches();
  }, [loadBranches]);

  /** Reload from a user action, showing the spinner while it runs. */
  const refreshBranches = useCallback(() => {
    setLoadingBranches(true);
    setBranchError(null);
    void loadBranches();
  }, [loadBranches]);

  /**
   * Request a switch. The server decides whether confirmation is needed by
   * re-reading the working tree itself — the client never makes that call from
   * possibly-stale state it is holding.
   */
  const requestSwitch = useCallback(
    async (branch: BranchInfo, confirmDirty: boolean) => {
      setBusyBranch(branch.name);
      try {
        const result = await api.switchBranch(
          repository.id,
          branch.name,
          branch.kind,
          confirmDirty,
        );

        if (result.outcome === 'needs-confirmation') {
          setPending(branch);
          setConfirmStatus(result.status);
          return;
        }

        setListing(result.branches);
        setPending(null);
        setConfirmStatus(null);

        const created = result.createdTrackingBranch;
        toast.push({
          tone: 'success',
          title: created
            ? `Created local branch “${created}” tracking ${branch.name}.`
            : `Switched ${repository.name} to ${branch.name}.`,
          detail: result.status.clean
            ? undefined
            : describeStatus(result.status).description,
        });
        onChanged();
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        toast.push({
          tone: 'error',
          title: apiError?.message ?? `Could not switch ${repository.name}.`,
          detail: apiError?.detail,
        });
        // Git may have refused because the branch list moved under us.
        refreshBranches();
        onChanged();
      } finally {
        setBusyBranch(null);
      }
    },
    [repository.id, repository.name, toast, onChanged, refreshBranches],
  );

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(repository.absolutePath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.push({
        tone: 'error',
        title: 'Could not copy to the clipboard.',
        detail: 'Your browser blocked clipboard access. Select the path and copy it manually.',
      });
    }
  }

  async function reveal() {
    try {
      await api.reveal(repository.id);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      toast.push({
        tone: 'error',
        title: apiError?.message ?? 'Could not open the file manager.',
        detail: apiError?.detail,
      });
    }
  }

  const presentation = describeStatus(repository.status, repository.problem);

  return (
    <aside
      aria-label={`${repository.name} details`}
      className="flex h-full w-full flex-col overflow-y-auto border-edge bg-surface xl:w-[26rem] xl:border-l"
    >
      <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{repository.name}</h2>
          <p className="mt-0.5 text-xs text-ink-faint">Repository details</p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close details">
          ✕
        </Button>
      </div>

      <div className="flex flex-col gap-5 px-5 py-4">
        {repository.problem ? (
          <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm">
            <p className="font-medium">{presentation.label}</p>
            <p className="mt-1 leading-relaxed text-ink-muted">{presentation.description}</p>
            {repository.problemDetail ? (
              <p className="mt-1.5 font-mono text-xs break-words text-ink-muted">
                {repository.problemDetail}
              </p>
            ) : null}
          </div>
        ) : null}

        <section className="flex flex-col gap-2">
          <Detail label="Workspace path">
            <PathText value={repository.relativePath} className="text-ink" />
          </Detail>
          <Detail label="Absolute path">
            <PathText value={repository.absolutePath} className="text-ink" />
          </Detail>
          <Detail label="Current branch">
            <BranchLabel head={repository.head} />
          </Detail>
          <Detail label="Working tree">
            <StatusBadge status={repository.status} problem={repository.problem} />
          </Detail>
          <Detail label="Group">
            <label className="sr-only" htmlFor={`panel-group-${repository.id}`}>
              Group for {repository.name}
            </label>
            <select
              id={`panel-group-${repository.id}`}
              value={repository.groupId ?? ''}
              onChange={(event) => onAssign(repository, event.target.value || null)}
              className="w-full max-w-[14rem] rounded-md border border-edge bg-surface px-2 py-1 text-sm"
            >
              <option value="">Ungrouped</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Detail>
        </section>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void copyPath()}>{copied ? 'Copied' : 'Copy path'}</Button>
          <Button onClick={() => void reveal()} disabled={!repository.available}>
            Open in file manager
          </Button>
          <Button
            onClick={() => {
              refreshBranches();
              onChanged();
            }}
          >
            Refresh
          </Button>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Branches</h3>
          {repository.available ? (
            <BranchPicker
              listing={listing}
              loading={loadingBranches}
              error={branchError}
              busyBranch={busyBranch}
              onSwitch={(branch) => void requestSwitch(branch, false)}
              onRetry={refreshBranches}
            />
          ) : (
            <p className="rounded-md border border-dashed border-edge-strong px-3 py-6 text-center text-sm text-ink-muted">
              Branches are unavailable while this repository cannot be read.
            </p>
          )}
        </section>
      </div>

      <DirtySwitchDialog
        open={pending !== null}
        repositoryName={repository.name}
        branch={pending}
        status={confirmStatus}
        busy={busyBranch !== null}
        onCancel={() => {
          setPending(null);
          setConfirmStatus(null);
        }}
        onConfirm={() => {
          if (pending) void requestSwitch(pending, true);
        }}
      />
    </aside>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={cx('grid grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-2 text-sm')}>
      <span className="pt-0.5 text-ink-faint">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function PanelSkeleton() {
  return (
    <aside className="flex h-full w-full items-center justify-center border-edge bg-surface xl:w-[26rem] xl:border-l">
      <Spinner label="Loading repository…" />
    </aside>
  );
}
