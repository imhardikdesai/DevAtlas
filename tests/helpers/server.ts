import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface RunningServer {
  url: string;
  port: number;
  csrf: string;
  stop: () => Promise<void>;
  /** Everything the server wrote to stdout/stderr, for diagnosing failures. */
  log: () => string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Boot the real packaged server — the same `.next/standalone` bundle the CLI
 * launches — against a temporary workspace, on an ephemeral port.
 */
export async function startServer(
  workspaceRoot: string,
  env: Record<string, string | undefined> = {},
): Promise<RunningServer> {
  const entry = path.join(repoRoot, '.next', 'standalone', 'server.js');
  if (!existsSync(entry)) {
    throw new Error(
      `Missing ${entry}. Run \`npm run build\` before the integration tests.`,
    );
  }

  const port = await freePort();
  const csrf = `test-token-${port}`;
  const url = `http://127.0.0.1:${port}`;

  const child: ChildProcess = spawn(process.execPath, [entry], {
    cwd: path.dirname(entry),
    env: {
      ...process.env,
      ...env,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      DEVATLAS_WORKSPACE_ROOT: workspaceRoot,
      DEVATLAS_CSRF_SECRET: csrf,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const chunks: string[] = [];
  child.stdout?.on('data', (c: Buffer) => chunks.push(c.toString('utf8')));
  child.stderr?.on('data', (c: Buffer) => chunks.push(c.toString('utf8')));

  const log = () => chunks.join('');

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 4_000).unref();
    });
  };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early (code ${child.exitCode}):\n${log()}`);
    }
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2_000) });
      // Any answer, even an error body, means the HTTP server is listening.
      if (response.status < 500 || response.status === 500) {
        return { url, port, csrf, stop, log };
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  await stop();
  throw new Error(`Server never became ready:\n${log()}`);
}

export interface ApiCallOptions {
  method?: string;
  body?: unknown;
  /** Override the Origin header, to test the cross-origin rejection. */
  origin?: string | null;
  /** Override the CSRF token, to test the double-submit check. */
  csrf?: string | null;
  /** Override the Host header, to test the DNS-rebinding rejection. */
  host?: string;
}

export async function callApi(
  server: RunningServer,
  pathname: string,
  options: ApiCallOptions = {},
): Promise<{ status: number; body: any }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (method !== 'GET' && method !== 'HEAD') {
    headers['content-type'] = 'application/json';
    const origin = options.origin === undefined ? server.url : options.origin;
    if (origin !== null) headers.origin = origin;
    const csrf = options.csrf === undefined ? server.csrf : options.csrf;
    if (csrf !== null) headers['x-devatlas-csrf'] = csrf;
  }
  if (options.host) headers.host = options.host;

  const response = await fetch(`${server.url}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

/**
 * Send a raw HTTP/1.1 request over a socket.
 *
 * Node's fetch() silently drops a caller-supplied Host header (it is a
 * forbidden header name), so the DNS-rebinding guard can only be exercised by
 * writing the request line and headers ourselves.
 */
export function rawRequest(
  server: RunningServer,
  pathname: string,
  hostHeader: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(server.port, '127.0.0.1', () => {
      socket.write(
        `GET ${pathname} HTTP/1.1\r\n` +
          `Host: ${hostHeader}\r\n` +
          'Connection: close\r\n' +
          'Accept: application/json\r\n\r\n',
      );
    });

    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error('raw request timed out'));
    });
    socket.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(text)?.[1] ?? 0);
      const body = text.slice(text.indexOf('\r\n\r\n') + 4);
      resolve({ status, body });
    });
  });
}
