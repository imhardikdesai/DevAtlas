/**
 * `next build` with output: 'standalone' traces node_modules into
 * .next/standalone, but deliberately does not copy the static asset output or
 * the public directory. Without this step the packaged server returns 404 for
 * every stylesheet and script.
 */
import { cp, access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(standalone))) {
  console.error('postbuild: .next/standalone is missing — did `next build` run?');
  process.exit(1);
}

const copies = [
  [path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static')],
  [path.join(root, 'public'), path.join(standalone, 'public')],
];

for (const [from, to] of copies) {
  if (!(await exists(from))) continue;
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, force: true });
  console.log(`postbuild: copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}
