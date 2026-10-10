import { banner, field, line, pluralize, style, success, warn } from '@/cli/output';
import { launchServer, openDashboard, superviseUntilExit } from '@/cli/server-launch';
import { assertWritableWorkspace, resolveWorkspaceRoot } from '@/lib/config/paths';
import { DevAtlasError } from '@/lib/errors';
import { initialDiscovery, requireConfig, requireGit } from '@/lib/workspace/service';
import { ensureWorkspace } from '@/lib/workspace/store';

export interface RunOptions {
  /** Workspace path as typed by the user; undefined means the cwd. */
  target?: string;
  port?: number;
  openBrowser: boolean;
  /** False to prepare the workspace and exit without serving the dashboard. */
  startServer: boolean;
  /** init creates configuration; start requires it to exist already. */
  mode: 'init' | 'start';
}

/**
 * Shared implementation of `devatlas init` and `devatlas start`.
 *
 * The two differ only in whether configuration may be created: `start` refuses
 * to initialize, and `init` on an already-initialized workspace keeps every
 * piece of existing metadata and simply starts it.
 */
export async function run(options: RunOptions): Promise<number> {
  banner();

  const root = await resolveWorkspaceRoot(options.target);
  await requireGit();

  if (options.mode === 'init') {
    line('Initializing workspace...');
    await assertWritableWorkspace(root);
  }

  const { config, created } =
    options.mode === 'init'
      ? await ensureWorkspace(root)
      : { config: await requireConfig(root), created: false };

  if (options.mode === 'init' && !created) {
    line(style.yellow('This directory is already a DevAtlas workspace.'));
    line(style.dim('Existing name, groups and repository metadata are preserved.'));
    line();
  }

  field('Workspace', config.name);
  field('Path', config.rootPath);
  line();

  // Discovery runs on both paths: it is additive, so re-running it never
  // discards group assignments or renames.
  const { data, warnings } = await initialDiscovery(root);
  const available = data.repositories.filter((r) => r.available).length;
  const unavailable = data.repositories.length - available;

  if (available === 0) {
    line(style.yellow('No Git repositories were discovered in this workspace.'));
    line(
      style.dim(
        'Add repositories below this directory and use Refresh in the dashboard, or re-run this command.',
      ),
    );
  } else {
    line(`Discovered ${pluralize(available, 'repository', 'repositories')}.`);
  }
  if (unavailable > 0) {
    line(
      style.dim(
        `${pluralize(unavailable, 'repository', 'repositories')} previously known but not found; metadata kept.`,
      ),
    );
  }
  for (const warning of warnings.slice(0, 5)) {
    warn(`${warning.path}: ${warning.reason}`);
  }
  if (warnings.length > 5) {
    warn(`${warnings.length - 5} further discovery warnings suppressed.`);
  }

  if (options.mode === 'init') {
    line(created ? 'Configuration created successfully.' : 'Configuration loaded.');
  }
  line();

  if (!options.startServer) {
    success('Workspace is ready. Run `devatlas start` to open the dashboard.');
    return 0;
  }

  const launch = await launchServer({
    root,
    config,
    preferredPort: options.port,
  });

  if (launch.reusedExisting) {
    line(style.yellow('DevAtlas is already running for this workspace.'));
  }
  field('Dashboard', style.cyan(launch.url));
  line();

  if (options.openBrowser) await openDashboard(launch.url);

  if (!launch.child) {
    success('Opened the existing DevAtlas instance.');
    return 0;
  }

  success('DevAtlas is running.');
  line(style.dim('Press Ctrl+C to stop.'));

  return superviseUntilExit(root, launch.child);
}

/** `devatlas start` on an uninitialized directory gets an actionable message. */
export function describeNotInitialized(error: DevAtlasError, target: string): string {
  return error.code === 'NOT_INITIALIZED'
    ? `Run \`devatlas init ${target}\` to set this directory up as a workspace.`
    : '';
}
