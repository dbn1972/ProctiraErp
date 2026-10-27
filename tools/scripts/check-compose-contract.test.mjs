/**
 * Local compose contract (PRC-L335, PRC-L460).
 * Run with: node --test tools/scripts/check-compose-contract.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkBuiltServiceHealthchecks,
  checkDockerInitPasswords,
  checkPostgresBootstrap,
  composeDefault,
} from './check-compose-contract.mjs';

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

const BASE_POSTGRES = {
  POSTGRES_USER: '${POSTGRES_USER:-proctira}',
  POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}',
};
const FIXED_POSTGRES = {
  POSTGRES_USER: '${POSTGRES_BOOTSTRAP_USER:-postgres}',
  POSTGRES_PASSWORD: '${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}',
  MIGRATOR_PASSWORD: '${MIGRATOR_PASSWORD:?Set MIGRATOR_PASSWORD}',
  APP_ROLE_PASSWORD: '${APP_ROLE_PASSWORD:?Set APP_ROLE_PASSWORD}',
};

test('PRC-L460: base compose (migrator is the container superuser) fails', () => {
  const errors = checkPostgresBootstrap({ services: { postgres: { environment: BASE_POSTGRES } } });
  assert.match(errors.join('\n'), /POSTGRES_USER defaults to 'proctira'/);
  assert.match(errors.join('\n'), /MIGRATOR_PASSWORD must be required/);
  assert.match(errors.join('\n'), /APP_ROLE_PASSWORD must be required/);
});

test('PRC-L460: separate bootstrap superuser + required role passwords pass', () => {
  assert.deepEqual(
    checkPostgresBootstrap({ services: { postgres: { environment: FIXED_POSTGRES } } }),
    [],
  );
  const literal = { ...FIXED_POSTGRES, POSTGRES_USER: 'proctira_app' };
  assert.equal(
    checkPostgresBootstrap({ services: { postgres: { environment: literal } } }).length,
    1,
  );
});

test('PRC-L460: composeDefault reads ${VAR:-x}, ${VAR-x} and literals', () => {
  assert.equal(composeDefault('${A:-postgres}'), 'postgres');
  assert.equal(composeDefault('${A-postgres}'), 'postgres');
  assert.equal(composeDefault('${A}'), '');
  assert.equal(composeDefault('postgres'), 'postgres');
});

test('PRC-L460: hard-coded role passwords in docker-init fail (base 02_local_passwords.sql)', () => {
  const errors = checkDockerInitPasswords({
    '02_local_passwords.sql': "ALTER ROLE proctira_app PASSWORD 'proctira_app_dev_password';\n",
    '02_local_passwords.sh': "ALTER ROLE proctira PASSWORD :'migrator_pw';\n",
  });
  assert.deepEqual(errors, [
    'db/docker-init/02_local_passwords.sql:1 hard-codes a role password (PRC-L460)',
  ]);
});

test('repository docker-compose.yml passes the contract', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
