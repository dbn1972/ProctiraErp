import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname),
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.live.test.ts'],
    // Worker threads ignore runtime process.env.TZ changes; TZ tests need a fork.
    poolMatchGlobs: [['**/*-tz.test.ts', 'forks']],
  },
});
