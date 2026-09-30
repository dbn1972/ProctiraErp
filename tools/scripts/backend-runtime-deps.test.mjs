#!/usr/bin/env node
/**
 * PRC-L178 — backend bundles must not rely on phantom (undeclared) deps, and the
 * runtime resolve hook only falls back to declared workspace dependencies.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as esbuild from 'esbuild';
import {
  createFsOwnerLookup,
  declaredRuntimeDeps,
  findUndeclaredExternals,
  packageNameOf,
} from './backend-runtime-deps-lib.mjs';
import { createExternalizeNonWorkspacePlugin } from './bundle-backend-runtime.mjs';
import { buildDeclaredResolvers, resolve } from './backend-runtime-resolve-hook.mjs';

test('packageNameOf normalizes bare specifiers and skips builtins/relative', () => {
  assert.equal(packageNameOf('fastify'), 'fastify');
  assert.equal(packageNameOf('@prisma/client/runtime'), '@prisma/client');
  assert.equal(packageNameOf('lodash/fp'), 'lodash');
  assert.equal(packageNameOf('node:fs'), null);
  assert.equal(packageNameOf('fs'), null);
  assert.equal(packageNameOf('./x.js'), null);
  assert.equal(packageNameOf('@scope'), null);
});

test('declaredRuntimeDeps ignores devDependencies', () => {
  const deps = declaredRuntimeDeps({
    dependencies: { a: '1' },
    peerDependencies: { b: '1' },
    optionalDependencies: { c: '1' },
    devDependencies: { d: '1' },
  });
  assert.deepEqual([...deps].sort(), ['a', 'b', 'c']);
});

test('bundle check fails when the entry imports an undeclared package', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prc-l178-'));
  try {
    const pkgDir = join(root, 'svc');
    mkdirSync(join(pkgDir, 'src'), { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'svc', dependencies: { declared: '1.0.0' } }),
    );
    writeFileSync(
      join(pkgDir, 'src/server.ts'),
      "import 'declared';\nimport 'phantom-pkg/sub';\nimport { readFileSync } from 'node:fs';\nconsole.log(readFileSync);\n",
    );
    /** @type {Array<{ specifier: string, importer: string }>} */
    const externals = [];
    await esbuild.build({
      absWorkingDir: pkgDir,
      entryPoints: [join(pkgDir, 'src/server.ts')],
      outfile: join(pkgDir, 'dist/server.js'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
      plugins: [createExternalizeNonWorkspacePlugin(externals)],
    });
    const violations = findUndeclaredExternals(externals, createFsOwnerLookup());
    assert.equal(violations.length, 1, violations.join('\n'));
    assert.match(violations[0], /^phantom-pkg: imported by .*server\.ts but not declared/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolve hook fallback only resolves declared workspace dependencies', async () => {
  // Real repo: api-gateway declares `fastify`; nobody declares `left-pad-phantom`.
  const resolvers = buildDeclaredResolvers([
    join(import.meta.dirname, '../../apps/api-gateway/package.json'),
  ]);
  assert.ok(resolvers.has('fastify'));
  assert.ok(!resolvers.has('left-pad-phantom'));

  const failing = async () => {
    const err = new Error('ERR_MODULE_NOT_FOUND');
    throw err;
  };
  await assert.rejects(() => resolve('left-pad-phantom', {}, failing), /ERR_MODULE_NOT_FOUND/);
  await assert.rejects(() => resolve('./rel.js', {}, failing), /ERR_MODULE_NOT_FOUND/);
  // `fastify` is declared by a workspace package, so the fallback resolves it.
  const hit = await resolve('fastify', {}, failing);
  assert.equal(hit.shortCircuit, true);
  assert.match(hit.url, /node_modules\/.*fastify/);
});
