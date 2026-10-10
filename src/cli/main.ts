import { run } from '@/cli/commands/run';
import { errorLine, fail, line, style } from '@/cli/output';
import { DEFAULT_PORT } from '@/lib/config/paths';
import { DevAtlasError, isDevAtlasError } from '@/lib/errors';

const USAGE = `${style.bold('DevAtlas')} — a local-first workspace for your Git repositories.

${style.bold('Usage')}
  devatlas init [path]     Initialize a workspace and open the dashboard
  devatlas start [path]    Start an existing workspace and open the dashboard
  devatlas help            Show this message
  devatlas version         Print the DevAtlas version

${style.bold('Options')}
  --port <number>          Preferred port (default ${DEFAULT_PORT}; the next free port is used if taken)
  --no-open                Do not open a browser automatically
  --no-start               Set the workspace up and exit without starting the dashboard

${style.bold('Examples')}
  devatlas init
  devatlas init ./my-project
  devatlas start /absolute/path/to/my-project
`;

interface ParsedArgs {
  command: string;
  target?: string;
  port?: number;
  openBrowser: boolean;
  startServer: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  let port: number | undefined;
  let openBrowser = true;
  let startServer = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (arg === '--no-open') {
      openBrowser = false;
      continue;
    }
    if (arg === '--open') {
      openBrowser = true;
      continue;
    }
    if (arg === '--no-start') {
      // Set the workspace up without launching the dashboard: useful for
      // provisioning scripts and CI, where no browser should ever open.
      startServer = false;
      continue;
    }
    if (arg === '--port' || arg === '-p') {
      const value = argv[i + 1];
      i += 1;
      const parsed = Number(value);
      if (!value || !Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new DevAtlasError('INVALID_INPUT', `--port needs a number between 1 and 65535.`);
      }
      port = parsed;
      continue;
    }
    if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new DevAtlasError('INVALID_INPUT', `--port needs a number between 1 and 65535.`);
      }
      port = parsed;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      positional.unshift('help');
      continue;
    }
    if (arg === '-v' || arg === '--version') {
      positional.unshift('version');
      continue;
    }
    if (arg.startsWith('-')) {
      throw new DevAtlasError('INVALID_INPUT', `Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  const [command = 'help', target] = positional;
  return { command, target, port, openBrowser, startServer };
}

/** Human-readable next step for each failure mode the CLI can hit. */
function hintFor(error: DevAtlasError, target: string): string | undefined {
  switch (error.code) {
    case 'GIT_MISSING':
      return 'Install Git from https://git-scm.com/downloads and make sure `git --version` works in this terminal.';
    case 'NOT_INITIALIZED':
      return `Run \`devatlas init ${target}\` to set this directory up as a workspace.`;
    case 'INVALID_CONFIG':
      return `DevAtlas has not changed any of your files. Inspect ${target}/.devatlas/ and fix or remove the reported file, then try again.`;
    case 'PATH_NOT_FOUND':
    case 'PATH_NOT_DIRECTORY':
      return 'Check the path and try again, or run `devatlas init` with no arguments to use the current directory.';
    case 'PATH_NOT_WRITABLE':
      return 'Choose a directory you can write to, or adjust the permissions on this one.';
    case 'PORT_UNAVAILABLE':
      return 'Free one of those ports, or pass a different one with `--port <number>`.';
    case 'SERVER_START_FAILED':
      return 'If you installed DevAtlas from source, run `npm run build` first so the application bundle exists.';
    default:
      return undefined;
  }
}

async function printVersion(): Promise<number> {
  try {
    const { packageVersion } = await import('@/cli/package-root');
    line(packageVersion());
    return 0;
  } catch (error) {
    // Failing to read our own manifest means the install is broken; say so
    // rather than printing a reassuring "unknown".
    fail(
      'Could not read the DevAtlas version.',
      error instanceof Error ? error.message : String(error),
      'The installation looks incomplete. Reinstall DevAtlas.',
    );
    return 1;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    errorLine(USAGE);
    return 2;
  }

  const target = parsed.target ?? '.';

  switch (parsed.command) {
    case 'init':
    case 'start':
      break;
    case 'help':
      line(USAGE);
      return 0;
    case 'version':
      return await printVersion();
    default:
      fail(`Unknown command: ${parsed.command}`);
      errorLine(USAGE);
      return 2;
  }

  try {
    return await run({
      target: parsed.target,
      port: parsed.port,
      openBrowser: parsed.openBrowser,
      startServer: parsed.startServer,
      mode: parsed.command === 'init' ? 'init' : 'start',
    });
  } catch (error) {
    if (isDevAtlasError(error)) {
      fail(error.message, error.detail, hintFor(error, target));
      return 1;
    }
    fail(
      'DevAtlas stopped because of an unexpected error.',
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return 1;
  }
}
