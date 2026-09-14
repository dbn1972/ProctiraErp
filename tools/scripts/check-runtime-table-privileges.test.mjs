#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-11 COMPLETE runtime privilege catalog gate.
 * Run with: node --test tools/scripts/check-runtime-table-privileges.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  evaluateRuntimePrivileges,
  extractPublicTables,
  generateSyncSql,
  loadCatalog,
} from './runtime-table-privileges-lib.mjs';
import { main as checkMain, parseArgs } from './check-runtime-table-privileges.mjs';

const MIN_CATALOG = {
  version: 1,
  tables: {
    schema_migrations: 'denied',
    _prisma_migrations: 'denied',
    insights_ui_templates: 'select_insert',
    insights_ui_indicators: 'select_insert',
    insights_ui_geo_features: 'select_insert',
    fee_ledger_entries: 'append_only',
    audit_log_entries: 'append_only',
    workflow_transition_audit: 'append_only',
    transcript_issuances: 'append_only',
    audit_log_archive: 'append_only',
    enrollment_history: 'append_only',
    grade_change_audit: 'append_only',
    students: 'dml',
  },
};

const GOOD_ROLE_SQL = `
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proctira_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO proctira_app;
`;

const BAD_ROLE_SQL = `
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proctira_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO proctira_app;
`;

const GOOD_CLASSIFY_SQL = `
-- W1-DATA-11 COMPLETE
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM proctira_app;
INSERT INTO schema_migrations (filename)
VALUES ('084_runtime_privilege_classification.sql')
ON CONFLICT (filename) DO NOTHING;
`;

test('extractPublicTables finds CREATE TABLE and always includes ledgers', () => {
  const tables = extractPublicTables(`
CREATE TABLE IF NOT EXISTS students (id UUID);
CREATE TABLE public.enrollments (id UUID);
`);
  assert.equal(tables.has('students'), true);
  assert.equal(tables.has('enrollments'), true);
  assert.equal(tables.has('schema_migrations'), true);
  assert.equal(tables.has('_prisma_migrations'), true);
});

test('generateSyncSql revokes defaults and grants by class', () => {
  const sql = generateSyncSql({ tables: MIN_CATALOG.tables, classes: {}, sequences: {} });
  assert.match(sql, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE[\s\S]*ON TABLES FROM proctira_app/);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE %I TO proctira_app/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO proctira_app/);
  assert.match(sql, /'schema_migrations'/);
  assert.match(sql, /'students'/);
  assert.doesNotMatch(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO proctira_app/);
});

test('evaluateRuntimePrivileges passes a complete classified fixture', () => {
  const corpus = new Set(Object.keys(MIN_CATALOG.tables));
  const report = evaluateRuntimePrivileges({
    catalog: { tables: MIN_CATALOG.tables },
    corpusTables: corpus,
    roleSql: GOOD_ROLE_SQL,
    classifySql: GOOD_CLASSIFY_SQL,
    applySql: 'bash apply-runtime-table-privileges.sh\n',
    syncScript: 'runtime-table-privileges.json sync\n',
  });
  assert.equal(report.ok, true, report.issues.join('; '));
});

test('evaluateRuntimePrivileges fails on unclassified table', () => {
  const corpus = new Set([...Object.keys(MIN_CATALOG.tables), 'rogue_future_table']);
  const report = evaluateRuntimePrivileges({
    catalog: { tables: MIN_CATALOG.tables },
    corpusTables: corpus,
    roleSql: GOOD_ROLE_SQL,
    classifySql: GOOD_CLASSIFY_SQL,
    applySql: 'bash apply-runtime-table-privileges.sh\n',
    syncScript: 'runtime-table-privileges.json sync\n',
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /rogue_future_table/.test(i)));
});

test('evaluateRuntimePrivileges fails when 050 restores blanket TABLE defaults', () => {
  const corpus = new Set(Object.keys(MIN_CATALOG.tables));
  const report = evaluateRuntimePrivileges({
    catalog: { tables: MIN_CATALOG.tables },
    corpusTables: corpus,
    roleSql: BAD_ROLE_SQL,
    classifySql: GOOD_CLASSIFY_SQL,
    applySql: 'bash apply-runtime-table-privileges.sh\n',
    syncScript: 'runtime-table-privileges.json sync\n',
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /DEFAULT PRIVILEGES/.test(i)));
});

test('repo tip satisfies the catalog gate', () => {
  const code = checkMain(process.cwd(), { json: false });
  assert.equal(code, 0);
});

test('parseArgs accepts --root and --json', () => {
  const args = parseArgs(['--root=/tmp/x', '--json']);
  assert.equal(args.root, '/tmp/x');
  assert.equal(args.json, true);
});

test('fixture repo missing catalog entry fails gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'priv-gate-'));
  mkdirSync(join(root, 'db/sql'), { recursive: true });
  mkdirSync(join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(join(root, 'packages/shared/database/prisma/migrations'), { recursive: true });

  writeFileSync(
    join(root, 'db/sql/001_fixture.sql'),
    'CREATE TABLE IF NOT EXISTS students (id UUID);\nCREATE TABLE IF NOT EXISTS orphan_tbl (id UUID);\n',
  );
  writeFileSync(join(root, 'db/runtime-table-privileges.json'), JSON.stringify(MIN_CATALOG, null, 2));
  writeFileSync(join(root, 'db/sql/050_app_runtime_role.sql'), GOOD_ROLE_SQL);
  writeFileSync(join(root, 'db/sql/084_runtime_privilege_classification.sql'), GOOD_CLASSIFY_SQL);
  writeFileSync(
    join(root, 'tools/scripts/apply-sql.sh'),
    'apply-runtime-table-privileges.sh\n',
  );
  writeFileSync(
    join(root, 'tools/scripts/apply-runtime-table-privileges.sh'),
    'runtime-table-privileges sync\n',
  );

  // Point check at fixture by evaluating manually with lib paths relative to fixture.
  const catalog = loadCatalog(join(root, 'db/runtime-table-privileges.json'));
  const corpusTables = extractPublicTables(readFileSync(join(root, 'db/sql/001_fixture.sql'), 'utf8'));
  // required append_only/select_insert tables are not in fixture corpus → will also fail;
  // focus assertion on orphan.
  const report = evaluateRuntimePrivileges({
    catalog,
    corpusTables: new Set([...Object.keys(MIN_CATALOG.tables), 'orphan_tbl']),
    roleSql: GOOD_ROLE_SQL,
    classifySql: GOOD_CLASSIFY_SQL,
    applySql: 'apply-runtime-table-privileges.sh',
    syncScript: 'runtime-table-privileges',
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => /orphan_tbl/.test(i)));
});
