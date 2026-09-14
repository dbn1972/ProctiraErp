#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-17 migration timeout gate.
 * Run with: node --test tools/scripts/check-migration-timeouts.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  applySqlTimeoutContract,
  databasePackageMigrateContract,
  evaluateMigrationTimeouts,
  policyDocContract,
  prismaWrapperContract,
  timeoutsLibContract,
} from './check-migration-timeouts.mjs';

const GOOD_LIB = `
: "\${MIGRATION_LOCK_TIMEOUT:=5s}"
: "\${MIGRATION_STATEMENT_TIMEOUT:=30min}"
: "\${APPLY_SQL_LOCK_TIMEOUT:=\${MIGRATION_LOCK_TIMEOUT}}"
: "\${APPLY_SQL_STATEMENT_TIMEOUT:=\${MIGRATION_STATEMENT_TIMEOUT}}"
inject_migration_timeout_url() { :; }
export_migration_timeout_pgoptions() { :; }
`;

const GOOD_APPLY = `
# W1-DATA-17
source "$ROOT/tools/scripts/migration-timeouts.sh"
APPLY_SQL_LOCK_TIMEOUT=5s
APPLY_SQL_STATEMENT_TIMEOUT=30min
psql_q() {
  printf "SET lock_timeout TO '%s';\\n" "\${APPLY_SQL_LOCK_TIMEOUT}"
  printf "SET statement_timeout TO '%s';\\n" "\${APPLY_SQL_STATEMENT_TIMEOUT}"
}
`;

const GOOD_PRISMA = `
# W1-DATA-17
source migration-timeouts.sh
inject_migration_timeout_url
prisma migrate deploy
`;

const GOOD_AUDIT = `
# DATA — W1-DATA-17
lock_timeout and statement_timeout on apply.
Online-safe: CREATE INDEX CONCURRENTLY, ADD CONSTRAINT … NOT VALID then VALIDATE.
`;

const GOOD_README = `
## Migration session timeouts (W1-DATA-17)
Sets lock_timeout / statement_timeout. Prefer CONCURRENTLY and online-safe patterns.
`;

function writeFixture({
  lib = GOOD_LIB,
  apply = GOOD_APPLY,
  prisma = GOOD_PRISMA,
  pkgScript = 'bash ../../../tools/scripts/prisma-migrate-deploy.sh',
  audit = GOOD_AUDIT,
  readme = GOOD_README,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'w1-data17-'));
  mkdirSync(join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(join(root, 'packages/shared/database'), { recursive: true });
  mkdirSync(join(root, 'docs/audits'), { recursive: true });
  mkdirSync(join(root, 'db'), { recursive: true });
  writeFileSync(join(root, 'tools/scripts/migration-timeouts.sh'), lib);
  writeFileSync(join(root, 'tools/scripts/apply-sql.sh'), apply);
  writeFileSync(join(root, 'tools/scripts/prisma-migrate-deploy.sh'), prisma);
  writeFileSync(
    join(root, 'packages/shared/database/package.json'),
    JSON.stringify({ scripts: { 'prisma:migrate:deploy': pkgScript } }, null, 2),
  );
  writeFileSync(join(root, 'docs/audits/DATA_W1_DATA_17_TIMEOUTS.md'), audit);
  writeFileSync(join(root, 'db/README.md'), readme);
  return root;
}

test('timeoutsLibContract requires lock + statement defaults and helpers', () => {
  assert.equal(timeoutsLibContract(GOOD_LIB).length, 0);
  assert.ok(timeoutsLibContract('').some((i) => /missing/.test(i)));
  assert.ok(timeoutsLibContract(': "${MIGRATION_LOCK_TIMEOUT:=5s}"').length > 0);
});

test('applySqlTimeoutContract requires SET lock/statement_timeout', () => {
  assert.equal(applySqlTimeoutContract(GOOD_APPLY).length, 0);
  assert.ok(applySqlTimeoutContract('# W1-DATA-17\nsource migration-timeouts.sh').length > 0);
});

test('prismaWrapperContract requires URL injection + migrate deploy', () => {
  assert.equal(prismaWrapperContract(GOOD_PRISMA).length, 0);
  assert.ok(prismaWrapperContract('# W1-DATA-17\nmigrate deploy').length > 0);
});

test('databasePackageMigrateContract rejects bare prisma migrate deploy', () => {
  assert.equal(
    databasePackageMigrateContract(
      JSON.stringify({ scripts: { 'prisma:migrate:deploy': 'bash ../../../tools/scripts/prisma-migrate-deploy.sh' } }),
    ).length,
    0,
  );
  const bare = databasePackageMigrateContract(
    JSON.stringify({ scripts: { 'prisma:migrate:deploy': 'prisma migrate deploy' } }),
  );
  assert.ok(bare.length > 0);
});

test('policyDocContract requires audit + README coverage', () => {
  assert.equal(policyDocContract(GOOD_AUDIT, GOOD_README).length, 0);
  assert.ok(policyDocContract('', GOOD_README).length > 0);
  assert.ok(policyDocContract(GOOD_AUDIT, '# db').length > 0);
});

test('evaluateMigrationTimeouts passes a complete fixture', () => {
  const root = writeFixture();
  const report = evaluateMigrationTimeouts(root);
  assert.equal(report.ok, true, report.issues.join('; '));
});

test('evaluateMigrationTimeouts fails when apply-sql omits SET', () => {
  const root = writeFixture({
    apply: '# W1-DATA-17\nsource migration-timeouts.sh\nAPPLY_SQL_LOCK_TIMEOUT=1\nAPPLY_SQL_STATEMENT_TIMEOUT=1\n',
  });
  const report = evaluateMigrationTimeouts(root);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /SET lock_timeout/.test(i)));
});

test('evaluateMigrationTimeouts fails when package uses bare prisma', () => {
  const root = writeFixture({ pkgScript: 'prisma migrate deploy' });
  const report = evaluateMigrationTimeouts(root);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /prisma-migrate-deploy\.sh|bare/.test(i)));
});

test('repo root passes the live gate', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const report = evaluateMigrationTimeouts(repoRoot);
  assert.equal(report.ok, true, report.issues.join('; '));
});
