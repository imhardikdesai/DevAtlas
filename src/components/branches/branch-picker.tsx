'use client';

import { useMemo, useState } from 'react';

import { Button, EmptyState, Spinner, TextInput, cx } from '@/components/ui/primitives';
import type { BranchInfo, BranchListing } from '@/types';

export interface BranchPickerProps {
  listing: BranchListing | null;
  loading: boolean;
  error: string | null;
  busyBranch: string | null;
  onSwitch: (branch: BranchInfo) => void;
  onRetry: () => void;
}

/**
 * Searchable branch list, split into Local and Remote.
 *
 * Remote branches without a local counterpart are labelled so it is obvious
 * beforehand that choosing one creates a local tracking branch rather than
 * silently doing something unexpected.
 */
export function BranchPicker({
  listing,
  loading,
  error,
  busyBranch,
  onSwitch,
  onRetry,
}: BranchPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!listing) return { local: [], remote: [] };
    const needle = query.trim().toLocaleLowerCase();
    const match = (branch: BranchInfo) =>
      needle === '' || branch.name.toLocaleLowerCase().includes(needle);
    return {
      local: listing.local.filter(match),
      remote: listing.remote.filter(match),
    };
  }, [listing, query]);

  if (loading) {
    return (
      <div className="py-6">
        <Spinner label="Reading branches…" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        glyph="!"
        title="Could not list branches"
        body={<span className="font-mono text-xs break-words">{error}</span>}
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    );
  }

  if (!listing) return null;

  const total = filtered.local.length + filtered.remote.length;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label htmlFor="branch-search" className="sr-only">
          Search branches
        </label>
        <TextInput
          id="branch-search"
          type="search"
          value={query}
          placeholder="Search branches…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {total === 0 ? (
        <p className="rounded-md border border-dashed border-edge-strong px-3 py-6 text-center text-sm text-ink-muted">
          No branches match “{query}”.
        </p>
      ) : null}

      <BranchSection
        title="Local"
        branches={filtered.local}
        busyBranch={busyBranch}
        onSwitch={onSwitch}
        emptyMessage="This repository has no local branches yet."
      />

      <BranchSection
        title="Remote"
        branches={filtered.remote}
        busyBranch={busyBranch}
        onSwitch={onSwitch}
        emptyMessage={
          query.trim()
            ? 'No remote branches match your search.'
            : 'No remote-tracking branches. Add a remote and fetch to see them here.'
        }
      />
    </div>
  );
}

function BranchSection({
  title,
  branches,
  busyBranch,
  onSwitch,
  emptyMessage,
}: {
  title: string;
  branches: BranchInfo[];
  busyBranch: string | null;
  onSwitch: (branch: BranchInfo) => void;
  emptyMessage: string;
}) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-medium tracking-wide text-ink-faint uppercase">
        {title}
        <span className="ml-1.5 tabular-nums">({branches.length})</span>
      </h4>
      {branches.length === 0 ? (
        <p className="px-1 text-xs text-ink-faint">{emptyMessage}</p>
      ) : (
        <ul className="max-h-60 overflow-y-auto rounded-md border border-edge">
          {branches.map((branch) => (
            <li
              key={branch.ref}
              className={cx(
                'flex items-center justify-between gap-2 border-b border-edge px-3 py-2 last:border-b-0',
                branch.current ? 'bg-accent-soft' : 'bg-surface',
              )}
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm" title={branch.name}>
                  {branch.name}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
                  {branch.sha ? <span className="font-mono">{branch.sha}</span> : null}
                  {branch.upstream ? <span>tracks {branch.upstream}</span> : null}
                  {branch.remoteOnlyLocalName ? (
                    <span className="text-caution">
                      creates local branch “{branch.remoteOnlyLocalName}”
                    </span>
                  ) : null}
                </p>
              </div>

              {branch.current ? (
                <span className="shrink-0 rounded-full border border-accent/30 bg-surface px-2 py-0.5 text-xs font-medium text-accent">
                  Current
                </span>
              ) : (
                <Button
                  variant="secondary"
                  className="shrink-0"
                  disabled={busyBranch !== null}
                  onClick={() => onSwitch(branch)}
                >
                  {busyBranch === branch.name ? 'Switching…' : 'Switch'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
