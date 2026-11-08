import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  noExternal: [
    '@sre-studio/provider-binary',
    '@sre-studio/provider-android',
  ],
  external: [
    '@sre-studio/core',
    '@sre-studio/shared',
    'better-sqlite3',
  ],
});

