/**
 * PRC-L111 — Dependabot covers every Dockerfile and compose directory.
 * Run with: node --test tools/scripts/check-dependabot-coverage.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCoverage, dirMatches, parseDependabot } from './check-dependabot-coverage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const SCRIPT = join(HERE, 'check-dependabot-coverage.mjs');
const FILES = [
  'Dockerfile.fastify-base',
  'apps/web/Dockerfile',
  'apps/api-gateway/Dockerfile',
  'workers/exam-document/Dockerfile',
  'infrastructure/docker/Dockerfile.web',
  'docker-compose.yml',
  'infra/observability/docker-compose.observability.yml',
  'infrastructure/docker/docker-compose.services.yml',
  'apps/web/package.json',
];
const BASE_CONFIG = `version: 2
updates:
  - package-ecosystem: npm
    directory: /
  - package-ecosystem: docker
    directory: /infrastructure/docker
`;

test('base config (docker only for /infrastructure/docker, no compose) fails', () => {
  const errors = checkCoverage(parseDependabot(BASE_CONFIG), FILES);
  assert.ok(errors.some((e) => /Dockerfile directory \/apps\/web is not covered/.test(e)));
  assert.ok(errors.some((e) => /Dockerfile directory \/ is not covered/.test(e)));
  assert.ok(
    errors.some((e) => /compose file directory \/ is not covered by a docker-compose/.test(e)),
  );
});

test('parser reads directory, inline directories and block directories', () => {
  const entries = parseDependabot(`updates:
  - package-ecosystem: docker
    directories: ['/', '/apps/*'] # comment
  - package-ecosystem: docker-compose
    directories:
      - /
      - '/infra/observability'
    schedule:
      interval: weekly
  - package-ecosystem: pub
    directory: /apps/mobile
`);
  assert.deepEqual(entries, [
    { ecosystem: 'docker', directories: ['/', '/apps/*'] },
    { ecosystem: 'docker-compose', directories: ['/', '/infra/observability'] },
    { ecosystem: 'pub', directories: ['/apps/mobile'] },
  ]);
});

test('glob matching: * is one segment, ** is any depth, / is root', () => {
  assert.equal(dirMatches('/', ''), true);
  assert.equal(dirMatches('/', 'apps/web'), false);
  assert.equal(dirMatches('/apps/*', 'apps/web'), true);
  assert.equal(dirMatches('/apps/*', 'apps/web/sub'), false);
  assert.equal(dirMatches('/apps/**', 'apps/web/sub'), true);
  assert.equal(dirMatches('/infrastructure/docker', 'infrastructure/docker'), true);
});

test('fixed config covers every directory', () => {
  const text = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8');
  assert.deepEqual(checkCoverage(parseDependabot(text), FILES), []);
});

test('repository: every tracked Dockerfile/compose directory is covered', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  const text = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8');
  assert.deepEqual(checkCoverage(parseDependabot(text), files.filter(Boolean)), []);
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
