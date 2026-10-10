import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 ships native flat configs, so no FlatCompat bridge is
 * needed (and the bridge in fact crashes on this config's plugin graph).
 */
const config = [
  {
    ignores: ['.next/**', 'dist/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Test helpers deliberately read loosely-typed JSON responses.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default config;
