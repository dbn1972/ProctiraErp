import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname),
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    passWithNoTests: true,
    // H-D3: the 304 migration cases take ACCESS EXCLUSIVE on the hostel tables
    // (rolled back); keep files serial so they never race pg-hostel-repository.test.ts.
    fileParallelism: false,
  },
});
