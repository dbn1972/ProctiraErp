#!/usr/bin/env node
/**
 * PRC-L183 — operational scripts must not ship default credentials and must
 * refuse to run (usage error, exit 2) when credentials are not supplied.
 * Run with: node --test tools/scripts/operational-script-credentials.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = [
  'tools/scripts/validate-phase2-auth-ec3.sh',
  'tools/scripts/setup-live-db-and-onboard.sh',
];
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('static: no committed default credentials or fixed /tmp token files', () => {
  for (const rel of SCRIPTS) {
    const src = read(rel);
    assert.doesNotMatch(src, /proctira-india-admin/, `${rel}: admin password default`);
    assert.doesNotMatch(src, /proctira_dev_password/, `${rel}: DB password default`);
    assert.doesNotMatch(
      src,
      /\$\{(?:INDIA_ADMIN_EMAIL|INDIA_ADMIN_PASSWORD|DATABASE_URL_HOST|DATABASE_URL|PGPASSWORD):-[^}]/,
      `${rel}: credential variable must not have a non-empty :- default`,
    );
    assert.doesNotMatch(src, /\/tmp\/phase2-/, `${rel}: fixed /tmp output path`);
  }
});

test('static: the realm export and auth tests carry no India admin password (PRC-L183)', () => {
  for (const rel of [
    'infra/keycloak/proctira-realm.json',
    'packages/backend/auth/src/keycloak/routes.test.ts',
  ]) {
    assert.doesNotMatch(read(rel), /proctira-india-admin/, `${rel}: India admin password`);
  }
  const realm = JSON.parse(read('infra/keycloak/proctira-realm.json'));
  for (const user of realm.users ?? []) {
    assert.equal(user.credentials, undefined, `realm user ${user.username} ships a credential`);
  }
});
// Minimal env: no credentials; unreachable URLs so nothing can talk to a
// real service even if a guard regressed.
const bareEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  WEB_URL: 'http://127.0.0.1:9',
  API_URL: 'http://127.0.0.1:9',
};

test('validate-phase2-auth-ec3.sh exits with usage error per missing credential', () => {
  const cases = [
    [{}, 'DATABASE_URL_HOST'],
    [{ DATABASE_URL_HOST: 'postgresql://x@127.0.0.1:9/x' }, 'INDIA_ADMIN_EMAIL'],
    [
      { DATABASE_URL_HOST: 'postgresql://x@127.0.0.1:9/x', INDIA_ADMIN_EMAIL: 'a@example.test' },
      'INDIA_ADMIN_PASSWORD',
    ],
  ];
  for (const [extra, missing] of cases) {
    const r = spawnSync('bash', [join(ROOT, SCRIPTS[0])], {
      env: { ...bareEnv, ...extra },
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(r.status, 2, `expected usage exit for missing ${missing}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`${missing} is required`));
    assert.match(r.stderr, /usage:/);
  }
});

test('setup-live-db-and-onboard.sh exits with usage error when DATABASE_URL is unset', () => {
  const r = spawnSync('bash', [join(ROOT, SCRIPTS[1])], {
    env: { ...bareEnv, ARTIFACT_DIR: join(ROOT, 'node_modules/.cache/prc-l183-never-created') },
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /DATABASE_URL is required/);
});
