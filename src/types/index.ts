/**
 * Shared DevAtlas domain types.
 *
 * Persisted shapes (WorkspaceConfig, WorkspaceData, ...) are inferred from the
 * Zod schemas in src/lib/validation so there is exactly one source of truth.
 * This module re-exports them alongside the purely in-memory types that
 * describe live Git state, which is deliberately never written to disk.
 */

export type {
  WorkspaceConfig,
  WorkspaceData,
  RepositoryRecord,
  GroupRecord,
  RuntimeRecord,
} from '@/lib/validation/schemas';

/** Result of running a single git child process. */
export interface GitResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be spawned or timed out. */
  failure?: 'missing-git' | 'timeout' | 'spawn-error';
}

/** Which kind of HEAD a repository currently has. */
export type HeadKind = 'branch' | 'detached' | 'unborn' | 'unknown';

export interface HeadState {
  kind: HeadKind;
  /** Branch name when kind === 'branch' or 'unborn'; undefined when detached. */
  branch?: string;
  /** Short commit sha when kind === 'detached'. */
  commit?: string;
}

/** Counts derived from `git status --porcelain=v1 -z`. */
export interface WorkingTreeStatus {
  clean: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  /** Total number of entries reported by git. */
  total: number;
}

export interface BranchInfo {
  /** Short name: `main` for locals, `origin/main` for remotes. */
  name: string;
  /** Full ref: `refs/heads/main`. */
  ref: string;
  kind: 'local' | 'remote';
  /** Short object name of the branch tip. */
  sha: string;
  /** Upstream short name for local branches that track one. */
  upstream?: string;
  /** True when this is the checked-out branch. */
  current: boolean;
  /**
   * Remote branches only: the branch name without the remote prefix, set when
   * no local branch of that name exists yet. Switching to one of these creates
   * a local tracking branch.
   */
  remoteOnlyLocalName?: string;
  /** Remote branches only: the remote name, e.g. `origin`. */
  remote?: string;
}

export interface BranchListing {
  local: BranchInfo[];
  remote: BranchInfo[];
  current?: string;
  head: HeadState;
}

/** Why a repository could not be read. */
export type RepositoryProblem =
  | 'missing'
  | 'inaccessible'
  | 'not-a-repository'
  | 'git-error';

/** A repository record joined with live Git state for the dashboard. */
export interface RepositoryView {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  available: boolean;
  groupId: string | null;
  groupName: string | null;
  head: HeadState | null;
  status: WorkingTreeStatus | null;
  problem?: RepositoryProblem;
  problemDetail?: string;
}

export interface WorkspaceView {
  workspaceId: string;
  name: string;
  rootPath: string;
  createdAt: string;
  repositoryCount: number;
}

/** Stable machine-readable error codes surfaced by the API and the CLI. */
export type DevAtlasErrorCode =
  | 'NOT_INITIALIZED'
  | 'INVALID_CONFIG'
  | 'GIT_MISSING'
  | 'PATH_NOT_FOUND'
  | 'PATH_NOT_DIRECTORY'
  | 'PATH_NOT_WRITABLE'
  | 'PATH_ESCAPES_WORKSPACE'
  | 'REPOSITORY_NOT_FOUND'
  | 'REPOSITORY_UNAVAILABLE'
  | 'BRANCH_NOT_FOUND'
  | 'WORKING_TREE_DIRTY'
  | 'GIT_REFUSED'
  | 'GIT_ERROR'
  | 'GROUP_NOT_FOUND'
  | 'GROUP_NAME_TAKEN'
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'PORT_UNAVAILABLE'
  | 'SERVER_START_FAILED'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: {
    code: DevAtlasErrorCode;
    message: string;
    /** Verbatim git stderr, when the failure came from git. */
    detail?: string;
  };
}
