#!/usr/bin/env node
/**
 * PRC-M259. Run with: node --test tools/scripts/detect-affected-services.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  affectedFromFiles,
  detectAffected,
  dockerConfig,
  loadManifest,
  servicesInScope,
} from './detect-affected-services.mjs';

const manifest = loadManifest();

function repoWithCommits(commits) {
  const dir = mkdtempSync(join(tmpdir(), 'affected-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  for (const file of commits) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), `${Math.random()}\n`);
    git('add', '.');
    git('commit', '-q', '-m', file);
  }
  return { dir, base, head: git('rev-parse', 'HEAD') };
}

test('3-commit push where the first commit changes apps/web deploys web', () => {
  const { dir, base, head } = repoWithCommits([
    'apps/web/src/page.tsx',
    'docs/a.md',
    'docs/b.md',
  ]);
  const services = detectAffected({ manifest, workflow: 'deploy', base, head, cwd: dir });
  assert.deepEqual(services, ['web']);
});

test('unknown base fails safe to every service in scope', () => {
  const { dir, head } = repoWithCommits(['docs/a.md']);
  assert.deepEqual(
    detectAffected({ manifest, workflow: 'deploy', base: '', head, cwd: dir }),
    servicesInScope(manifest, 'deploy'),
  );
  assert.deepEqual(
    detectAffected({ manifest, workflow: 'deploy', base: 'deadbeef', head, cwd: dir }),
    servicesInScope(manifest, 'deploy'),
  );
});

test('packages/ui maps to web and portals; infrastructure/docker fans out', () => {
  const ui = affectedFromFiles(manifest, 'release', ['packages/ui/components/src/x.tsx']);
  assert.ok(ui.includes('web') && ui.includes('admin-console') && ui.includes('registration-portal'));
  assert.ok(!ui.includes('api-gateway'));
  assert.deepEqual(
    affectedFromFiles(manifest, 'release', ['infrastructure/docker/Dockerfile.web']),
    servicesInScope(manifest, 'release'),
  );
});

test('admin-console uses Dockerfile.nextjs-app with its port', () => {
  assert.deepEqual(dockerConfig(manifest, 'admin-console'), {
    dockerfile: 'infrastructure/docker/Dockerfile.nextjs-app',
    buildArgs: ['APP_NAME=admin-console', 'APP_PORT=3014'],
  });
  assert.equal(dockerConfig(manifest, 'student').buildArgs[1], 'SERVICE_PORT=3021');
  assert.throws(() => dockerConfig(manifest, 'nope'));
});
