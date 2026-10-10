import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Git and filesystem work is slow; integration tests boot a real server.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
