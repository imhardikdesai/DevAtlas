'use client';

import type {
  ApiErrorBody,
  BranchListing,
  DevAtlasErrorCode,
  GroupRecord,
  RepositoryView,
  WorkingTreeStatus,
  WorkspaceView,
} from '@/types';

const CSRF_HEADER = 'x-devatlas-csrf';

/** An error returned by the local API, carrying its stable code. */
export class ApiError extends Error {
  readonly code: DevAtlasErrorCode;
  readonly detail?: string;

  constructor(code: DevAtlasErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
  }
}

function token(): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector('meta[name="devatlas-csrf"]')?.getAttribute('content') ?? '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('content-type', 'application/json');
    headers.set(CSRF_HEADER, token());
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, method, headers, credentials: 'same-origin' });
  } catch (error) {
    throw new ApiError(
      'INTERNAL',
      'Could not reach the DevAtlas server. It may have stopped.',
      error instanceof Error ? error.message : String(error),
    );
  }

  const text = await response.text();
  const body: unknown = text ? safeParse(text) : undefined;

  if (!response.ok) {
    const apiError = (body as ApiErrorBody | undefined)?.error;
    throw new ApiError(
      apiError?.code ?? 'INTERNAL',
      apiError?.message ?? `Request failed with status ${response.status}.`,
      apiError?.detail,
    );
  }
  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface RepositoriesResponse {
  workspace: WorkspaceView;
  repositories: RepositoryView[];
  groups: GroupRecord[];
}

export interface RefreshResponse extends RepositoriesResponse {
  discovery: { added: number; removed: number; warnings: { path: string; reason: string }[] };
}

export type SwitchResponse =
  | { outcome: 'needs-confirmation'; status: WorkingTreeStatus }
  | {
      outcome: 'switched';
      branches: BranchListing;
      status: WorkingTreeStatus;
      createdTrackingBranch: string | null;
    };

export const api = {
  repositories: (force = false) =>
    request<RepositoriesResponse>(`/api/repositories${force ? '?force=1' : ''}`),

  refresh: () => request<RefreshResponse>('/api/repositories/refresh', { method: 'POST' }),

  repository: (id: string) =>
    request<{ repository: RepositoryView }>(`/api/repositories/${encodeURIComponent(id)}`),

  branches: (id: string) =>
    request<{ branches: BranchListing }>(`/api/repositories/${encodeURIComponent(id)}/branches`),

  switchBranch: (id: string, branch: string, kind: 'local' | 'remote', confirmDirty: boolean) =>
    request<SwitchResponse>(`/api/repositories/${encodeURIComponent(id)}/branches/switch`, {
      method: 'POST',
      body: JSON.stringify({ branch, kind, confirmDirty }),
    }),

  reveal: (id: string) =>
    request<{ revealed: boolean }>(`/api/repositories/${encodeURIComponent(id)}/reveal`, {
      method: 'POST',
    }),

  renameWorkspace: (name: string) =>
    request<{ workspace: WorkspaceView }>('/api/workspace', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  createGroup: (name: string) =>
    request<{ group: GroupRecord; groups: GroupRecord[] }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  renameGroup: (id: string, name: string) =>
    request<{ group: GroupRecord; groups: GroupRecord[] }>(`/api/groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  deleteGroup: (id: string) =>
    request<{ deleted: boolean; released: number; groups: GroupRecord[] }>(
      `/api/groups/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),

  assign: (repositoryId: string, groupId: string | null) =>
    request<{ groups: GroupRecord[] }>('/api/groups/assign', {
      method: 'PATCH',
      body: JSON.stringify({ repositoryId, groupId }),
    }),
};
