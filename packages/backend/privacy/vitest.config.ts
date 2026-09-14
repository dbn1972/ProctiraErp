import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@proctira/common': path.resolve(__dirname, '../../shared/common/src/index.ts'),
      '@proctira/logging': path.resolve(__dirname, '../../shared/logging/src/index.ts'),
      '@proctira/validation': path.resolve(__dirname, '../../shared/validation/src/index.ts'),
      '@proctira/queue-abstraction': path.resolve(
        __dirname,
        '../../shared/queue-abstraction/src/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname),
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: true,
  },
});
