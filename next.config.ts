import type { NextConfig } from 'next';

/**
 * DevAtlas ships as a self-contained npm package. `output: 'standalone'` emits
 * `.next/standalone/server.js` together with a traced node_modules tree, so the
 * installed CLI can launch the production app without Next being resolvable at
 * runtime and without a development server.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // The app is local-only; never emit source maps or telemetry-ish extras.
  productionBrowserSourceMaps: false,
  /**
   * Filesystem and child-process calls make Next trace the whole project into
   * .next/standalone. None of this is needed at runtime — the server runs the
   * compiled output — so it is excluded to keep the published package small.
   */
  outputFileTracingExcludes: {
    '**/*': [
      './src/**',
      './tests/**',
      './scripts/**',
      './.next/cache/**',
      './node_modules/typescript/**',
      './node_modules/eslint/**',
      './node_modules/@typescript-eslint/**',
      './node_modules/eslint-config-next/**',
      './node_modules/vitest/**',
      './node_modules/@vitest/**',
      './node_modules/tsup/**',
      './node_modules/esbuild/**',
      './node_modules/@esbuild/**',
      './node_modules/rolldown/**',
      './node_modules/@tailwindcss/**',
      './node_modules/tailwindcss/**',
      // DevAtlas renders no images, so Next's optional image-optimization
      // native binaries (~18 MB) are dead weight in the published package.
      './node_modules/sharp/**',
      './node_modules/@img/**',
    ],
  },
};

export default nextConfig;
