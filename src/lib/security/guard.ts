import { timingSafeEqual } from 'node:crypto';

import { DevAtlasError } from '@/lib/errors';

export const CSRF_COOKIE = 'devatlas_csrf';
export const CSRF_HEADER = 'x-devatlas-csrf';

/** Hostnames the dashboard is allowed to be reached on. */
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The per-run CSRF token. The CLI generates it and passes it to the server
 * process; `next dev` without the CLI falls back to a development constant so
 * the dashboard still works when run with `npm run dev`.
 */
export function csrfToken(): string {
  return process.env.DEVATLAS_CSRF_SECRET || 'devatlas-dev-token';
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function hostnameOf(value: string): string {
  // Strip a port, handling bracketed IPv6 literals.
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? value : value.slice(0, close + 1);
  }
  const colon = value.lastIndexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

/**
 * Validate a local request before any handler acts on it.
 *
 * Binding to loopback is not treated as a security boundary on its own:
 *
 *  - The Host header must name a loopback hostname, which defeats DNS
 *    rebinding (an attacker's domain resolving to 127.0.0.1 arrives with their
 *    hostname in Host, not ours).
 *  - State-changing methods additionally require a same-origin Origin header,
 *    a same-origin Sec-Fetch-Site when the browser sends one, and a
 *    double-submit CSRF token that a cross-site page cannot read.
 */
export function guardRequest(request: Request): void {
  const url = new URL(request.url);

  const host = request.headers.get('host');
  if (!host || !ALLOWED_HOSTNAMES.has(hostnameOf(host))) {
    throw new DevAtlasError(
      'FORBIDDEN',
      'DevAtlas only accepts requests addressed to localhost.',
    );
  }

  if (SAFE_METHODS.has(request.method)) return;

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new DevAtlasError('FORBIDDEN', 'Cross-site requests are not allowed.');
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    throw new DevAtlasError('FORBIDDEN', 'Missing Origin header.');
  }
  let originHost: string;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('bad protocol');
    }
    originHost = parsed.host;
  } catch {
    throw new DevAtlasError('FORBIDDEN', 'Malformed Origin header.');
  }

  // Compare host:port. The dashboard is only ever served from one origin.
  if (originHost !== url.host && originHost !== host) {
    throw new DevAtlasError('FORBIDDEN', 'Cross-origin requests are not allowed.');
  }
  if (!ALLOWED_HOSTNAMES.has(hostnameOf(originHost))) {
    throw new DevAtlasError('FORBIDDEN', 'Cross-origin requests are not allowed.');
  }

  const header = request.headers.get(CSRF_HEADER);
  if (!header || !constantTimeEqual(header, csrfToken())) {
    throw new DevAtlasError('FORBIDDEN', 'Missing or invalid CSRF token.');
  }
}
