import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  NOT_FROM_SHARED_BUNDLE,
  SECRET_NAME,
  compare,
  secretEnvReads,
} from './check-gateway-secret-allowlist.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const script = join(here, 'check-gateway-secret-allowlist.mjs');

function fixture(files, serviceKeys, optional = []) {
  const root = mkdtempSync(join(tmpdir(), 'gw-secrets-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  mkdirSync(join(root, 'infrastructure/helm/proctira-service'), { recursive: true });
  writeFileSync(
    join(root, 'infrastructure/helm/proctira-service/values.yaml'),
    [
      'externalSecret:',
      '  serviceKeys:',
      `    api-gateway: [${serviceKeys.join(', ')}]`,
      '  optionalServiceKeys:',
      `    api-gateway: [${optional.join(', ')}]`,
      '',
    ].join('\n'),
  );
  // Reuse the real install's js-yaml.
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
  return root;
}

test('secret-name heuristic', () => {
  for (const n of ['JWT_SECRET', 'KAFKA_SASL_PASSWORD', 'PHI_KMS_KEY_ID', 'DATABASE_URL']) {
    assert.ok(SECRET_NAME.test(n), n);
  }
  for (const n of ['NODE_ENV', 'PORT', 'KEYCLOAK_ISSUER', 'NEXT_PUBLIC_WEB_URL']) {
    assert.ok(!SECRET_NAME.test(n), n);
  }
});

test('compare reports missing reads and unused allowlist entries', () => {
  const reads = new Map([
    ['JWT_SECRET', 'a.ts'],
    ['SCHOLARSHIP_DOC_URL_SECRET', 'b.ts'],
    ['INSTALL_TOKEN', 'c.ts'],
  ]);
  const { missing, unused } = compare(reads, ['JWT_SECRET', 'COOKIE_SECRET']);
  assert.deepEqual(missing, ['SCHOLARSHIP_DOC_URL_SECRET']);
  assert.deepEqual(unused, ['COOKIE_SECRET']);
  assert.ok('INSTALL_TOKEN' in NOT_FROM_SHARED_BUNDLE);
});

test('scan sees gateway, backend and shared sources but not tests', () => {
  const root = fixture(
    {
      'apps/api-gateway/src/app.ts': "const s = process.env['KEYCLOAK_CLIENT_SECRET'];",
      'packages/backend/x/src/a.ts': 'const s = env.SCHOLARSHIP_DOC_URL_SECRET;',
      'packages/shared/y/src/b.ts': 'const s = process.env.KAFKA_SASL_PASSWORD;',
      'packages/backend/x/src/a.test.ts': 'process.env.TEST_ONLY_SECRET',
      'packages/backend/x/src/__tests__/c.ts': 'process.env.FIXTURE_SECRET',
    },
    [],
  );
  assert.deepEqual([...secretEnvReads(root).keys()].sort(), [
    'KAFKA_SASL_PASSWORD',
    'KEYCLOAK_CLIENT_SECRET',
    'SCHOLARSHIP_DOC_URL_SECRET',
  ]);
});

test('CLI fails on an unlisted secret and passes once listed (serviceKeys or optional)', () => {
  const files = { 'packages/backend/x/src/a.ts': "process.env['LMS_FILE_SIGNING_SECRET']" };
  const bad = fixture(files, ['JWT_SECRET']);
  assert.throws(
    () => execFileSync('node', [script, '--root', bad], { stdio: 'pipe' }),
    (err) => err.status === 1 && /LMS_FILE_SIGNING_SECRET/.test(String(err.stderr)),
  );
  execFileSync('node', [script, '--root', fixture(files, ['LMS_FILE_SIGNING_SECRET'])]);
  execFileSync('node', [script, '--root', fixture(files, [], ['LMS_FILE_SIGNING_SECRET'])]);
});

test('the repository allowlist covers every secret the gateway reads', () => {
  execFileSync('node', [script, '--root', repoRoot], { stdio: 'pipe' });
});
