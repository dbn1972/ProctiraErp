/**
 * Local compose contract (PRC-L335).
 * Run with: node --test tools/scripts/check-compose-contract.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkBuiltServiceHealthchecks } from './check-compose-contract.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-compose-contract.mjs');
const HC = { test: ['CMD', 'curl', '--fail', 'http://127.0.0.1:3001/api/health'] };

test('PRC-L335: a built service without a healthcheck fails', () => {
  const errors = checkBuiltServiceHealthchecks({
    services: { web: { build: { context: '.' }, healthcheck: HC }, portal: { build: '.' } },
  });
  assert.deepEqual(errors, [
    'docker-compose.yml service portal has build: but no healthcheck (PRC-L335)',
  ]);
});

test('PRC-L335: disabled or empty healthchecks fail; image-only services are out of scope', () => {
  const errors = checkBuiltServiceHealthchecks({
    services: {
      a: { build: '.', healthcheck: { disable: true } },
      b: { build: '.', healthcheck: {} },
      redis: { image: 'redis:7' },
    },
  });
  assert.equal(errors.length, 2);
});

test('repository docker-compose.yml passes the contract', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
