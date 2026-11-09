/**
 * Local compose contract (PRC-L335, PRC-L460, UAT-ENV-008, UAT-ENV-009).
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
  checkMinioImagePin,
  checkPostgresBootstrap,
  checkPublishedPortBindAddress,
  composeDefault,
  isLoopbackHostIp,
  parseImageRef,
  splitPortSpec,
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

test('UAT-ENV-009: splitPortSpec keeps ${...} and [...] intact', () => {
  assert.deepEqual(splitPortSpec('${BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-3001}:3001'), [
    '${BIND_ADDRESS:-127.0.0.1}',
    '${WEB_PORT:-3001}',
    '3001',
  ]);
  assert.deepEqual(splitPortSpec('[::1]:3000:3000/tcp'), ['[::1]', '3000', '3000/tcp']);
  assert.deepEqual(splitPortSpec('${GATEWAY_PORT:-3000}:3000'), ['${GATEWAY_PORT:-3000}', '3000']);
});
test('UAT-ENV-009: short-syntax ports without a loopback host IP fail (base api-gateway)', () => {
  const errors = checkPublishedPortBindAddress({
    services: {
      'api-gateway': { ports: ['${GATEWAY_PORT:-3000}:3000'] },
      bare: { ports: ['3001', 3002] },
      any: { ports: ['0.0.0.0:3003:3003', '${BIND_ADDRESS}:3004:3004'] },
    },
  });
  assert.equal(errors.length, 5);
  assert.match(errors[0], /service api-gateway publishes port \$\{GATEWAY_PORT:-3000\}:3000/);
  assert.match(errors[0], /UAT-ENV-009/);
});
test('UAT-ENV-009: BIND_ADDRESS default, literal loopback and [::1] pass', () => {
  assert.deepEqual(
    checkPublishedPortBindAddress({
      services: {
        'api-gateway': { ports: ['${BIND_ADDRESS:-127.0.0.1}:${GATEWAY_PORT:-3000}:3000'] },
        grafana: { ports: ['127.0.0.1:3050:3000', '[::1]:3051:3000/tcp'] },
        worker: { image: 'busybox' },
      },
    }),
    [],
  );
});
test('UAT-ENV-009: APP_BIND_ADDRESS loopback default passes, all-interfaces default fails', () => {
  const errors = checkPublishedPortBindAddress({
    services: {
      web: { ports: ['${APP_BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-3001}:3001'] },
      open: { ports: ['${APP_BIND_ADDRESS:-0.0.0.0}:${WEB_PORT:-3001}:3001'] },
    },
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /service open publishes/);
});
test('UAT-ENV-009: long-syntax ports need a loopback host_ip', () => {
  const errors = checkPublishedPortBindAddress({
    services: {
      ok: { ports: [{ target: 3001, published: '3001', host_ip: '127.0.0.1' }] },
      missing: { ports: [{ target: 3002, published: '3002' }] },
      open: { ports: [{ target: 3003, published: '3003', host_ip: '0.0.0.0' }] },
    },
  });
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /service missing publishes/);
  assert.match(errors.join('\n'), /service open publishes/);
});
test('UAT-ENV-009: isLoopbackHostIp resolves ${VAR:-default}', () => {
  assert.equal(isLoopbackHostIp('${BIND_ADDRESS:-127.0.0.1}'), true);
  assert.equal(isLoopbackHostIp('${BIND_ADDRESS:-0.0.0.0}'), false);
  assert.equal(isLoopbackHostIp('::1'), true);
  assert.equal(isLoopbackHostIp(''), false);
});

const PINNED_MINIO =
  'docker.io/alpine/minio:RELEASE.2025-10-15T17-29-55Z@sha256:cf23643a6cf9ce159c57643ceb88279e431262282428c9e0bf3a7ef1a97e84b4';

test('UAT-ENV-008: parseImageRef splits repository and digest', () => {
  assert.deepEqual(parseImageRef('minio/minio:latest'), { repository: 'minio/minio', digest: '' });
  assert.deepEqual(parseImageRef('localhost:5000/minio'), {
    repository: 'localhost:5000/minio',
    digest: '',
  });
  assert.equal(parseImageRef(PINNED_MINIO).repository, 'docker.io/alpine/minio');
  assert.match(parseImageRef(PINNED_MINIO).digest, /^sha256:cf23643a/);
});

test('UAT-ENV-008: base minio/minio:latest fails (no digest, unpullable repository)', () => {
  const errors = checkMinioImagePin({ services: { minio: { image: 'minio/minio:latest' } } });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /service minio image 'minio\/minio:latest' is not pinned by @sha256:/);
  assert.match(errors[1], /uses minio\/minio, which cannot be pulled anonymously/);
});

test('UAT-ENV-008: a tag-only or quay.io MinIO image fails', () => {
  const tagOnly = checkMinioImagePin({
    services: { s3: { image: 'docker.io/alpine/minio:RELEASE.2025-10-15T17-29-55Z' } },
  });
  assert.equal(tagOnly.length, 1);
  assert.match(tagOnly[0], /service s3 .* not pinned/);
  const quay = checkMinioImagePin({
    services: { minio: { image: `quay.io/minio/minio@${parseImageRef(PINNED_MINIO).digest}` } },
  });
  assert.deepEqual(quay.length, 1);
  assert.match(quay[0], /uses quay.io\/minio\/minio/);
});

test('UAT-ENV-008: the digest-pinned alpine/minio image passes; other images are out of scope', () => {
  assert.deepEqual(
    checkMinioImagePin({
      services: {
        minio: { image: PINNED_MINIO },
        redis: { image: 'redis:7' },
        web: { build: '.' },
      },
    }),
    [],
  );
});

test('repository docker-compose.yml passes the contract', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
