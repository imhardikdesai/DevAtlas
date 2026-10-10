'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, api, type RepositoriesResponse } from '@/lib/client/api';
import type { GroupRecord, RepositoryView, WorkspaceView } from '@/types';

export interface WorkspaceState {
  workspace: WorkspaceView | null;
  repositories: RepositoryView[];
  groups: GroupRecord[];
  loading: boolean;
  refreshing: boolean;
  error: ApiError | null;
}

export interface WorkspaceController extends WorkspaceState {
  /** Re-read live Git state without re-walking the filesystem. */
  reload: () => Promise<void>;
  /** Full rediscovery: walk the workspace again and merge the result. */
  rediscover: () => Promise<{ added: number; removed: number } | null>;
  setGroups: (groups: GroupRecord[]) => void;
  setWorkspace: (workspace: WorkspaceView) => void;
}

/**
 * Owns the dashboard's view of the workspace.
 *
 * Git state is always fetched from the server rather than inferred locally, so
 * what the dashboard shows is what Git reported on the last read.
 */
export function useWorkspace(): WorkspaceController {
  const [state, setState] = useState<WorkspaceState>({
    workspace: null,
    repositories: [],
    groups: [],
    loading: true,
    refreshing: false,
    error: null,
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback((response: RepositoriesResponse) => {
    if (!mounted.current) return;
    setState((current) => ({
      ...current,
      workspace: response.workspace,
      repositories: response.repositories,
      groups: response.groups,
      loading: false,
      refreshing: false,
      error: null,
    }));
  }, []);

  const fail = useCallback((error: unknown) => {
    if (!mounted.current) return;
    setState((current) => ({
      ...current,
      loading: false,
      refreshing: false,
      error:
        error instanceof ApiError
          ? error
          : new ApiError('INTERNAL', 'Something went wrong.', String(error)),
    }));
  }, []);

  const reload = useCallback(async () => {
    try {
      apply(await api.repositories(true));
    } catch (error) {
      fail(error);
    }
  }, [apply, fail]);

  const rediscover = useCallback(async () => {
    setState((current) => ({ ...current, refreshing: true }));
    try {
      const response = await api.refresh();
      apply(response);
      return { added: response.discovery.added, removed: response.discovery.removed };
    } catch (error) {
      fail(error);
      return null;
    }
  }, [apply, fail]);

  useEffect(() => {
    void (async () => {
      try {
        apply(await api.repositories());
      } catch (error) {
        fail(error);
      }
    })();
  }, [apply, fail]);

  // Re-read when the user comes back to the tab: branches and working trees
  // change outside DevAtlas all the time.
  useEffect(() => {
    const onFocus = () => {
      void reload();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const setGroups = useCallback((groups: GroupRecord[]) => {
    setState((current) => ({ ...current, groups }));
  }, []);

  const setWorkspace = useCallback((workspace: WorkspaceView) => {
    setState((current) => ({ ...current, workspace }));
  }, []);

  return { ...state, reload, rediscover, setGroups, setWorkspace };
}
