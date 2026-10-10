import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { DevAtlasError, isDevAtlasError } from '@/lib/errors';
import type { ApiErrorBody } from '@/types';

/** Local-only app: never let a response be cached or shared. */
const NO_STORE = {
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
} as const;

export function ok<T>(body: T, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(body, { ...init, headers: { ...NO_STORE, ...init.headers } });
}

export function failure(error: unknown): NextResponse {
  const normalized = normalize(error);
  const body: ApiErrorBody = {
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.detail ? { detail: normalized.detail } : {}),
    },
  };
  return NextResponse.json(body, { status: normalized.status, headers: NO_STORE });
}

function normalize(error: unknown): DevAtlasError {
  if (isDevAtlasError(error)) return error;

  if (error instanceof ZodError) {
    const detail = error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return new DevAtlasError('INVALID_INPUT', 'The request was not valid.', { detail });
  }

  return new DevAtlasError('INTERNAL', 'Something went wrong.', {
    detail: error instanceof Error ? error.message : String(error),
  });
}

/** Parse a JSON body, turning malformed JSON into a clean 400. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DevAtlasError('INVALID_INPUT', 'Expected a JSON request body.');
  }
}
