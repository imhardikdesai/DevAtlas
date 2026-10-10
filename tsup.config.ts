import { defineConfig } from 'tsup';

/**
 * The CLI is bundled so that everything under src/lib is inlined — the same
 * modules the Next server compiles. Runtime deps that must stay external are
 * listed below; `open` is bundled-safe but kept external so its platform
 * helper scripts resolve from node_modules.
 */
export default defineConfig({
  entry: { index: 'src/cli/index.ts' },
  outDir: 'dist/cli',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: false,
  clean: true,
  dts: false,
  external: ['open', 'next'],
});
