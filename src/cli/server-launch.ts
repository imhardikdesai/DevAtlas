import { randomBytes } from 'node:crypto';
import { type ChildProcess, spawn } from 'node:child_process';

import { resolveServerEntry } from '@/cli/package-root';
import { line, style, warn } from '@/cli/output';
import { selectPort } from '@/cli/port';
import { DEFAULT_HOST, DEFAULT_PORT } from '@/lib/config/paths';
import { DevAtlasError } from '@/lib/errors';
import { clearRuntime, isProcessAlive, readRuntime, writeRuntime } from '@/lib/workspace/store';
import type { WorkspaceConfig } from '@/types';

const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 150;

export interface LaunchOptions {
  root: string;
  config: WorkspaceConfig;
  host?: string;
  preferredPort?: number;
  /** Skip opening a browser (used by tests). */
  openBrowser?: boolean;
}

export interface LaunchResult {
  url: string;
  port: number;
  /** Undefined when an already-running instance was reused. */
  child?: ChildProcess;
  reusedExisting: boolean;
}

/** Ask a candidate server whether it is serving this exact workspace. */
async function probeHealth(url: string, workspaceId: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`, {
      headers: { host: new URL(url).host },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { workspaceId?: unknown };
    return body.workspaceId === workspaceId;
  } catch {
    return false;
  }
}

/**
 * If this workspace already has a healthy DevAtlas serving it, return its URL
 * instead of starting a second instance.
 */
async function findRunningInstance(
  root: string,
  workspaceId: string,
): Promise<string | undefined> {
  const runtime = await readRuntime(root);
  if (!runtime) return undefined;
  if (!isProcessAlive(runtime.pid)) {
    await clearRuntime(root);
    return undefined;
  }
  if (await probeHealth(runtime.url, workspaceId)) return runtime.url;
  await clearRuntime(root);
  return undefined;
}

/**
 * Start the packaged production server for `root`.
 *
 * The workspace path and CSRF secret are passed through the environment, so the
 * running server is pinned to exactly one workspace and a request can never
 * redirect it elsewhere.
 */
export async function launchServer(options: LaunchOptions): Promise<LaunchResult> {
  const { root, config } = options;
  const host = options.host ?? DEFAULT_HOST;

  const existing = await findRunningInstance(root, config.workspaceId);
  if (existing) {
    return {
      url: existing,
      port: Number(new URL(existing).port) || DEFAULT_PORT,
      reusedExisting: true,
    };
  }

  const entry = resolveServerEntry();
  const port = await selectPort(options.preferredPort ?? DEFAULT_PORT, host);
  const url = `http://${host}:${port}`;

  const child = spawn(
    process.execPath,
    [entry.script],
    {
      cwd: entry.cwd,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOSTNAME: host,
        HOST: host,
        PORT: String(port),
        DEVATLAS_WORKSPACE_ROOT: root,
        DEVATLAS_CSRF_SECRET: randomBytes(24).toString('hex'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  const serverLog: string[] = [];
  const collect = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    serverLog.push(text);
    if (serverLog.length > 50) serverLog.shift();
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.once('exit', (code, signal) => {
    exited = { code, signal };
  });

  const spawnError = await new Promise<Error | undefined>((resolve) => {
    child.once('error', resolve);
    setTimeout(() => resolve(undefined), 50);
  });
  if (spawnError) {
    throw new DevAtlasError('SERVER_START_FAILED', 'Could not start the DevAtlas server.', {
      detail: spawnError.message,
    });
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) {
      throw new DevAtlasError(
        'SERVER_START_FAILED',
        `The DevAtlas server exited before it was ready (code ${exited.code ?? exited.signal}).`,
        { detail: serverLog.join('').trim().slice(-2000) || undefined },
      );
    }
    if (await probeHealth(url, config.workspaceId)) {
      await writeRuntime(root, {
        pid: child.pid ?? process.pid,
        port,
        workspaceId: config.workspaceId,
        url,
        startedAt: new Date().toISOString(),
      });
      return { url, port, child, reusedExisting: false };
    }
    await delay(POLL_INTERVAL_MS);
  }

  child.kill('SIGTERM');
  throw new DevAtlasError(
    'SERVER_START_FAILED',
    `The DevAtlas server did not become ready within ${READY_TIMEOUT_MS / 1000} seconds.`,
    { detail: serverLog.join('').trim().slice(-2000) || undefined },
  );
}

/**
 * Open the dashboard in the default browser. A failure here is never fatal —
 * the URL has already been printed and the user can open it themselves.
 */
export async function openDashboard(url: string): Promise<void> {
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch (error) {
    warn(
      `Could not open your browser automatically (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
    line(`Open ${style.cyan(url)} manually to use DevAtlas.`);
  }
}

/**
 * Keep the CLI alive until the server exits or the user interrupts, then shut
 * the child down cleanly. Only DevAtlas's own child process is ever signalled.
 */
export function superviseUntilExit(root: string, child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    let shuttingDown = false;

    const finish = async (code: number) => {
      await clearRuntime(root);
      resolve(code);
    };

    const shutdown = (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        // Second Ctrl+C: stop waiting politely.
        child.kill('SIGKILL');
        return;
      }
      shuttingDown = true;
      line();
      line(style.dim('Shutting DevAtlas down...'));
      child.kill(signal);
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 5_000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGTERM'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGHUP', () => shutdown('SIGTERM'));

    child.once('exit', (code) => {
      void finish(shuttingDown ? 0 : (code ?? 0));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
