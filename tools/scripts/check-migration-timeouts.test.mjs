#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-17 migration timeout + DDL hazard + lock recovery gate.
 * Run with: node --test tools/scripts/check-migration-timeouts.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  applySqlLockRecoveryContract,
  applySqlTimeoutContract,
  databasePackageMigrateContract,
  evaluateDdlHazards,
  evaluateMigrationTimeouts,
  extractCreatedTables,
  findDdlHazards,
  isAtOrBeforeBaseline,
  loadDdlHazardWaiver,
  lockRecoveryDrillContract,
  packageJsonDuplicateScriptKeys,
  policyDocContract,
  prismaWrapperContract,
  stripSqlComments,
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
# per-file --single-transaction so lock_timeout / lock_not_available does not ledger-write
# recover: re-run after blockers; schema_migrations only after success
schema_migrations
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

const GOOD_COMPLETE = `
# DATA — W1-DATA-17 COMPLETE
Closes PARTIAL→COMPLETE: DDL hazard / expand-contract scan + maintenance-window waiver;
lock-contention recovery drill proves resume after lock_timeout.
`;

const GOOD_README = `
## Migration session timeouts (W1-DATA-17)
Sets lock_timeout / statement_timeout. Prefer CONCURRENTLY and online-safe patterns.
DDL hazard gate + maintenance-window hazard waiver for expand/contract safety.
`;

const GOOD_DRILL = `
# W1-DATA-17
ACCESS EXCLUSIVE lock_timeout lock_not_available
schema_migrations
export async function runLockRecoveryDrill() { /* resume after unlock */ }
`;

const GOOD_WAIVER = {
  baseline: {
    dbSqlMaxFilename: '001_old.sql',
    prismaMigrationMaxDir: '20200101_old',
    reason: 'test baseline',
  },
  waivers: [],
};

function writeFixture({
  lib = GOOD_LIB,
  apply = GOOD_APPLY,
  prisma = GOOD_PRISMA,
  pkgScript = 'bash ../../../tools/scripts/prisma-migrate-deploy.sh',
  audit = GOOD_AUDIT,
  complete = GOOD_COMPLETE,
  readme = GOOD_README,
  drill = GOOD_DRILL,
  waiver = GOOD_WAIVER,
  sqlFiles = {},
  prismaMigrations = {},
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'w1-data17-'));
  mkdirSync(join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(join(root, 'packages/shared/database/prisma/migrations'), { recursive: true });
  mkdirSync(join(root, 'docs/audits'), { recursive: true });
  mkdirSync(join(root, 'db/sql'), { recursive: true });
  writeFileSync(join(root, 'tools/scripts/migration-timeouts.sh'), lib);
  writeFileSync(join(root, 'tools/scripts/apply-sql.sh'), apply);
  writeFileSync(join(root, 'tools/scripts/prisma-migrate-deploy.sh'), prisma);
  writeFileSync(join(root, 'tools/scripts/migration-lock-recovery-drill.mjs'), drill);
  writeFileSync(
    join(root, 'tools/scripts/migration-ddl-hazard-waiver.json'),
    JSON.stringify(waiver, null, 2),
  );
  writeFileSync(
    join(root, 'packages/shared/database/package.json'),
    JSON.stringify({ scripts: { 'prisma:migrate:deploy': pkgScript } }, null, 2),
  );
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'check:migration-timeouts': 'node tools/scripts/check-migration-timeouts.mjs',
          'check:migration-timeouts:test':
            'node --test tools/scripts/check-migration-timeouts.test.mjs tools/scripts/migration-lock-recovery-drill.test.mjs',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, 'docs/audits/DATA_W1_DATA_17_TIMEOUTS.md'), audit);
  writeFileSync(join(root, 'docs/audits/DATA_W1_DATA_17_COMPLETE.md'), complete);
  writeFileSync(join(root, 'db/README.md'), readme);
  for (const [name, body] of Object.entries(sqlFiles)) {
    writeFileSync(join(root, 'db/sql', name), body);
  }
  for (const [dir, body] of Object.entries(prismaMigrations)) {
    mkdirSync(join(root, 'packages/shared/database/prisma/migrations', dir), { recursive: true });
    writeFileSync(
      join(root, 'packages/shared/database/prisma/migrations', dir, 'migration.sql'),
      body,
    );
  }
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

test('applySqlLockRecoveryContract requires resume guidance', () => {
  assert.equal(applySqlLockRecoveryContract(GOOD_APPLY).length, 0);
  assert.ok(applySqlLockRecoveryContract('# W1-DATA-17\nSET lock_timeout').length > 0);
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

test('policyDocContract requires audit + COMPLETE + README coverage', () => {
  assert.equal(policyDocContract(GOOD_AUDIT, GOOD_README, GOOD_COMPLETE).length, 0);
  assert.ok(policyDocContract('', GOOD_README, GOOD_COMPLETE).length > 0);
  assert.ok(policyDocContract(GOOD_AUDIT, '# db', GOOD_COMPLETE).length > 0);
  assert.ok(policyDocContract(GOOD_AUDIT, GOOD_README, '').length > 0);
});

test('lockRecoveryDrillContract requires contention + resume', () => {
  assert.equal(lockRecoveryDrillContract(GOOD_DRILL).length, 0);
  assert.ok(lockRecoveryDrillContract('# empty').length > 0);
});

test('stripSqlComments removes line and block comments', () => {
  const sql = stripSqlComments('CREATE /* x */ INDEX -- bad\n CONCURRENTLY ON t (id);');
  assert.match(sql, /CONCURRENTLY/);
  assert.doesNotMatch(sql, /bad/);
});

test('extractCreatedTables finds CREATE TABLE targets', () => {
  const tables = extractCreatedTables(
    'CREATE TABLE IF NOT EXISTS public.foo (id int);\nCREATE TABLE "Bar" (id int);',
  );
  assert.ok(tables.has('foo'));
  assert.ok(tables.has('bar'));
});

test('findDdlHazards flags blocking index on existing table', () => {
  const hazards = findDdlHazards('CREATE INDEX IF NOT EXISTS foo_idx ON hot_table (id);');
  assert.equal(hazards.length, 1);
  assert.equal(hazards[0].kind, 'blocking_index');
});

test('findDdlHazards allows index on table created in same file', () => {
  const sql = `
CREATE TABLE new_t (id int);
CREATE INDEX new_t_idx ON new_t (id);
`;
  assert.equal(findDdlHazards(sql).length, 0);
});

test('findDdlHazards allows CREATE INDEX CONCURRENTLY', () => {
  assert.equal(
    findDdlHazards('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS x ON hot (id);').length,
    0,
  );
});

test('findDdlHazards flags FK without NOT VALID', () => {
  const hazards = findDdlHazards(
    'ALTER TABLE child ADD CONSTRAINT child_parent_fk FOREIGN KEY (parent_id) REFERENCES parent(id);',
  );
  assert.ok(hazards.some((h) => h.kind === 'validating_constraint'));
});

test('findDdlHazards allows NOT VALID FK', () => {
  assert.equal(
    findDdlHazards(
      'ALTER TABLE child ADD CONSTRAINT child_parent_fk FOREIGN KEY (parent_id) REFERENCES parent(id) NOT VALID;',
    ).length,
    0,
  );
});

test('findDdlHazards flags SET NOT NULL and TYPE rewrite', () => {
  const nn = findDdlHazards('ALTER TABLE t ALTER COLUMN c SET NOT NULL;');
  assert.ok(nn.some((h) => h.kind === 'set_not_null'));
  const ty = findDdlHazards('ALTER TABLE t ALTER COLUMN c TYPE bigint USING c::bigint;');
  assert.ok(ty.some((h) => h.kind === 'column_type_rewrite'));
});

test('isAtOrBeforeBaseline uses inclusive string compare', () => {
  assert.equal(isAtOrBeforeBaseline('075_a.sql', '075_runtime.sql'), true);
  assert.equal(isAtOrBeforeBaseline('076_new.sql', '075_runtime.sql'), false);
});

test('evaluateDdlHazards grandfatheres baseline and fails new hazards', () => {
  const root = writeFixture({
    sqlFiles: {
      '001_old.sql': 'CREATE INDEX old_idx ON hot (id);',
      '002_new.sql': 'CREATE INDEX new_idx ON hot (id);',
    },
    waiver: {
      baseline: { dbSqlMaxFilename: '001_old.sql', prismaMigrationMaxDir: '20200101_old' },
      waivers: [],
    },
  });
  const report = evaluateDdlHazards(root);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /002_new\.sql/.test(i)));
  assert.ok(!report.issues.some((i) => /001_old\.sql/.test(i)));
});

test('evaluateDdlHazards accepts maintenance-window waiver', () => {
  const root = writeFixture({
    sqlFiles: {
      '002_new.sql': 'CREATE INDEX new_idx ON hot (id);',
    },
    waiver: {
      baseline: { dbSqlMaxFilename: '001_old.sql', prismaMigrationMaxDir: '20200101_old' },
      waivers: [
        {
          path: 'db/sql/002_new.sql',
          hazards: ['blocking_index'],
          reason: 'approved cutover window',
          maintenanceWindow: '2026-09-20T02:00Z',
          approvedBy: 'platform',
          expires: '2099-01-01',
        },
      ],
    },
  });
  const report = evaluateDdlHazards(root);
  assert.equal(report.ok, true, report.issues.join('; '));
  assert.ok(report.notes.some((n) => /waived blocking_index/.test(n)));
});

test('evaluateDdlHazards rejects expired waiver', () => {
  const root = writeFixture({
    sqlFiles: {
      '002_new.sql': 'CREATE INDEX new_idx ON hot (id);',
    },
    waiver: {
      baseline: { dbSqlMaxFilename: '001_old.sql', prismaMigrationMaxDir: '20200101_old' },
      waivers: [
        {
          path: 'db/sql/002_new.sql',
          hazards: ['blocking_index'],
          reason: 'stale',
          maintenanceWindow: '2020-01-01',
          expires: '2020-02-01',
        },
      ],
    },
  });
  const report = evaluateDdlHazards(root, undefined, undefined, new Date('2026-09-14'));
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /expired/.test(i)));
});

test('loadDdlHazardWaiver requires maintenanceWindow', () => {
  const root = writeFixture({
    waiver: {
      baseline: { dbSqlMaxFilename: '001_old.sql', prismaMigrationMaxDir: '20200101_old' },
      waivers: [{ path: 'db/sql/x.sql', hazards: ['blocking_index'], reason: 'x' }],
    },
  });
  assert.throws(() => loadDdlHazardWaiver(join(root, 'tools/scripts/migration-ddl-hazard-waiver.json')));
});

test('packageJsonDuplicateScriptKeys rejects duplicate scripts keys', () => {
  const dup = `{
  "scripts": {
    "check:migration-timeouts:test": "node --test tools/scripts/check-migration-timeouts.test.mjs tools/scripts/migration-lock-recovery-drill.test.mjs",
    "check:codeowners": "node tools/scripts/check-codeowners.mjs",
    "check:migration-timeouts:test": "node --test tools/scripts/check-migration-timeouts.test.mjs"
  }
}`;
  const issues = packageJsonDuplicateScriptKeys(dup);
  assert.ok(issues.some((i) => /declared 2 times/.test(i)), issues.join('; '));
  assert.ok(
    issues.some((i) => /migration-lock-recovery-drill\.test\.mjs/.test(i)),
    issues.join('; '),
  );
});

test('packageJsonDuplicateScriptKeys accepts unique scripts with both suites', () => {
  const good = `{
  "scripts": {
    "check:migration-timeouts": "node tools/scripts/check-migration-timeouts.mjs",
    "check:migration-timeouts:test": "node --test tools/scripts/check-migration-timeouts.test.mjs tools/scripts/migration-lock-recovery-drill.test.mjs"
  }
}`;
  assert.deepEqual(packageJsonDuplicateScriptKeys(good), []);
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

test('evaluateMigrationTimeouts fails on post-baseline DDL hazard', () => {
  const root = writeFixture({
    sqlFiles: {
      '002_bad.sql': 'ALTER TABLE t ALTER COLUMN c SET NOT NULL;',
    },
    waiver: {
      baseline: { dbSqlMaxFilename: '001_old.sql', prismaMigrationMaxDir: '20200101_old' },
      waivers: [],
    },
  });
  const report = evaluateMigrationTimeouts(root);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /SET NOT NULL|set_not_null|002_bad/.test(i)));
});

test('repo root passes the live gate', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const report = evaluateMigrationTimeouts(repoRoot);
  assert.equal(report.ok, true, report.issues.join('; '));
});
