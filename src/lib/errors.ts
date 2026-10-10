import type { DevAtlasErrorCode } from '@/types';

/**
 * A DevAtlas failure with a stable, machine-readable code. Both the CLI and the
 * HTTP API translate these into user-facing messages, so every expected failure
 * path should throw one of these rather than a bare Error.
 */
export class DevAtlasError extends Error {
  readonly code: DevAtlasErrorCode;
  readonly detail?: string;
  /** Suggested HTTP status when surfaced through the API. */
  readonly status: number;

  constructor(
    code: DevAtlasErrorCode,
    message: string,
    options: { detail?: string; status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'DevAtlasError';
    this.code = code;
    this.detail = options.detail;
    this.status = options.status ?? defaultStatus(code);
  }
}

function defaultStatus(code: DevAtlasErrorCode): number {
  switch (code) {
    case 'INVALID_INPUT':
    case 'BRANCH_NOT_FOUND':
    case 'GROUP_NAME_TAKEN':
    case 'WORKING_TREE_DIRTY':
      return 400;
    case 'FORBIDDEN':
    case 'PATH_ESCAPES_WORKSPACE':
      return 403;
    case 'NOT_INITIALIZED':
    case 'REPOSITORY_NOT_FOUND':
    case 'GROUP_NOT_FOUND':
    case 'PATH_NOT_FOUND':
      return 404;
    case 'REPOSITORY_UNAVAILABLE':
    case 'GIT_REFUSED':
    case 'GIT_ERROR':
      return 409;
    default:
      return 500;
  }
}

export function isDevAtlasError(value: unknown): value is DevAtlasError {
  return value instanceof DevAtlasError;
}

/** Narrow an unknown thrown value to a Node errno code, if it has one. */
export function errnoCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}
