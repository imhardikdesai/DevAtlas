/** Terminal output helpers. Colour is applied only when stdout is a TTY. */

const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

function paint(code: string, text: string): string {
  return useColor ? `\u001B[${code}m${text}\u001B[0m` : text;
}

export const style = {
  bold: (t: string) => paint('1', t),
  dim: (t: string) => paint('2', t),
  red: (t: string) => paint('31', t),
  green: (t: string) => paint('32', t),
  yellow: (t: string) => paint('33', t),
  cyan: (t: string) => paint('36', t),
};

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function errorLine(text = ''): void {
  process.stderr.write(`${text}\n`);
}

export function banner(): void {
  line();
  line(style.bold('DevAtlas'));
  line();
}

export function field(label: string, value: string): void {
  line(`${style.dim(`${label}:`)} ${value}`);
}

export function success(text: string): void {
  line(style.green(text));
}

export function warn(text: string): void {
  errorLine(`${style.yellow('Warning:')} ${text}`);
}

/** Report a failure with an optional detail block and a suggested next step. */
export function fail(message: string, detail?: string, hint?: string): void {
  errorLine();
  errorLine(`${style.red('Error:')} ${message}`);
  if (detail) errorLine(style.dim(`  ${detail}`));
  if (hint) {
    errorLine();
    errorLine(hint);
  }
  errorLine();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
