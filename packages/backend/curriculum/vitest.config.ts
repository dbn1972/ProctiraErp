import { createRequire } from 'node:module';
import path from 'path';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const repo = path.resolve(__dirname, '../../..');

function resolvePkg(name: string): string | undefined {
  const fromFiles = [
    path.join(__dirname, 'package.json'),
    path.join(repo, 'packages/backend/library/package.json'),
    path.join(repo, 'package.json'),
  ];
  for (const from of fromFiles) {
    if (!existsSync(from)) continue;
    try {
      return path.dirname(createRequire(from).resolve(`${name}/package.json`));
    } catch {
      /* try next */
    }
  }
  return undefined;
}

const fastifyRoot = resolvePkg('fastify');

export default defineConfig({
  resolve: {
    alias: {
      '@proctira/common': path.join(repo, 'packages/shared/common/src/index.ts'),
      '@proctira/database': path.join(repo, 'packages/shared/database/src/index.ts'),
      '@proctira/validation': path.join(repo, 'packages/shared/validation/src/index.ts'),
      ...(fastifyRoot ? { fastify: fastifyRoot } : {}),
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
