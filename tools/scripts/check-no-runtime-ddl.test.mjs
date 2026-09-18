#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  evaluateNoRuntimeDdl,
  evaluateRuntimeSchemaVersion,
  inspectRuntimeSource,
} from './check-no-runtime-ddl.mjs';
import { splitSqlPhases } from './split-sql-phases.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'no-runtime-ddl-'));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
}

test('rejects sync and async application reads of numbered SQL migrations', () => {
  for (const source of [
    `import { readFileSync } from 'node:fs';\n` +
      `const migrationPath = 'db/sql/010_schema.sql';\n` +
      `await pool.query(readFileSync(migrationPath, 'utf8'));`,
    `import { readFile } from 'node:fs/promises';\n` +
      `const migrationPath = join(root, 'db/sql/010_schema.sql');\n` +
      `const sql = await readFile(migrationPath, 'utf8');`,
    `import migrationSql from '../../../../db/sql/010_schema.sql';`,
    `import { readFileSync as load } from 'node:fs';\n` +
      `await pool.query(load('db/sql/010_schema.sql', 'utf8'));`,
    `import { readFileSync } from 'node:fs';\n` +
      `const load = readFileSync; await pool.query(load('db/sql/010_schema.sql', 'utf8'));`,
    `const migration = await import('../../../../db/sql/010_schema.sql');`,
  ]) {
    const issues = inspectRuntimeSource(source, 'packages/backend/x/src/store.ts');
    assert.ok(issues.some((issue) => /\.sql migration|\.sql migration asset/.test(issue)));
  }
});

test('rejects literal, variable, tagged-template, and query-config DDL', () => {
  for (const source of [
    "await pool.query('CREATE TABLE runtime_owned (id int)');",
    "const ddl = 'ALTER TABLE students ADD COLUMN unsafe int'; await pool.query(ddl);",
    "await pool.query({ text: 'DROP INDEX unsafe_idx' });",
    'await sql`CREATE UNIQUE INDEX unsafe_idx ON students (id)`;',
    "const ddl = 'CREATE ' + 'TABLE x(id int)'; await pool.query(ddl);",
    "function ddl() { return 'CREATE TABLE x(id int)'; } await pool.query(ddl());",
    "await pool.query('-- runtime guard\\nCREATE TABLE x(id int)');",
    "await pool['query']('ALTER TABLE x ADD COLUMN y int');",
    "const method = 'query'; await pool[method]('CREATE TABLE x(id int)');",
    "await pool.query('SET search_path=public; CREATE TABLE x(id int)');",
    "await pool.query('CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$');",
    "function unsafe() { const sql = 'CREATE TABLE hidden(id int)'; pool.query(sql); } const sql = 'SELECT 1'; unsafe();",
    "function run(sql) { return pool.query(sql); } run('CREATE TABLE hidden(id int)');",
    "const { query: execute } = pool; execute('CREATE TABLE hidden(id int)');",
    "function run(sql) { pool.query(sql); } const execute = run; execute('CREATE TABLE hidden(id int)');",
    "const sql = 'CREATE TABLE hidden(id int)'; for (const sql of ['SELECT 1']) {} pool.query(sql);",
    "let statement = 'CREATE TABLE hidden(id int)'; if (useSafeQuery) statement = 'SELECT 1'; pool.query(statement);",
    "const text = 'CREATE TABLE hidden(id int)'; pool.query({ text, values: [] });",
    "pool.query({ ['text']: 'CREATE TABLE hidden(id int)' });",
    "pool.query('CREATE TEMP TABLE runtime_owned(id int)');",
    "pool.query('CREATE SEQUENCE runtime_owned');",
  ]) {
    const issues = inspectRuntimeSource(source, 'apps/api/src/store.ts');
    assert.ok(
      issues.some((issue) => /DDL through/.test(issue)),
      source,
    );
  }
});

test('allows read-only readiness, comments, and ordinary user-facing text', () => {
  const issues = inspectRuntimeSource(`
    // pool.query('CREATE TABLE comment_only (id int)');
    const label = 'Create table view';
    await pool.query('SELECT to_regclass($1) AS relation', ['public.students']);
    await pool.query({ text: 'SELECT $1::text', values: ['CREATE TABLE is display text'] });
    function safeQuery() { const sql = 'SELECT 1'; return pool.query(sql); }
    function displayOnly() { const sql = 'CREATE TABLE is display text'; return sql; }
    function run(sql) { return pool.query(sql); }
    display.run('CREATE TABLE is display text');
  `);
  assert.deepEqual(issues, []);
});

test('scans runtime src and excludes test infrastructure', () => {
  const root = fixture({
    'apps/api/src/store.ts': "await pool.query('SELECT 1')\n",
    'apps/api/src/store.test.ts': "await pool.query('CREATE TABLE fixture (id int)')\n",
    'packages/backend/x/src/repository.ts':
      "const ddl = 'ALTER TABLE x ADD y int'; await pool.query(ddl)\n",
    'packages/shared/testing/src/test-db.ts':
      "await pool.query('CREATE TABLE test_fixture (id int)')\n",
    'tools/scripts/migrate.mjs': "await pool.query('CREATE TABLE migrator_owned (id int)')\n",
  });
  const report = evaluateNoRuntimeDdl(root);
  assert.equal(report.ok, false);
  assert.equal(report.issues.length, 1);
  assert.match(report.issues[0], /repository\.ts/);
});

test('fails when the runtime schema marker lags the latest non-seed migration', () => {
  const root = fixture({
    'db/sql/091_contract.sql': 'SELECT 1;',
    'db/sql/092_latest.sql': 'SELECT 1;',
    'db/sql/092b_demo_seed.sql': 'SELECT 1;',
    'packages/shared/database/src/schema-readiness.ts':
      "export const CURRENT_RUNTIME_SCHEMA_MIGRATION = '091_contract.sql';\n",
  });
  assert.deepEqual(evaluateRuntimeSchemaVersion(root), [
    'runtime schema marker is 091_contract.sql; latest non-seed migration is 092_latest.sql',
  ]);
});

test('hostel index repair preserves build, assertion, and cleanup phase ordering', () => {
  const migration = readFileSync(
    join(REPO_ROOT, 'db/sql/092_hostel_assignment_uniqueness.sql'),
    'utf8',
  );
  const phases = splitSqlPhases(migration);
  assert.equal(phases.length, 3);
  assert.match(phases[0], /CREATE UNIQUE INDEX CONCURRENTLY/);
  assert.match(phases[0], /DO \$swap_indexes\$/);
  assert.doesNotMatch(phases[0], /DROP INDEX CONCURRENTLY IF EXISTS public\.%I',\s*index_name/);
  assert.match(phases[1], /DO \$assert_indexes\$/);
  assert.match(phases[1], /proctira_hostel_assignment_index_ready/);
  assert.match(phases[2], /DROP INDEX CONCURRENTLY/);
  assert.match(phases[2], /proctira_hostel_assignment_index_ready/);
  assert.match(phases[2], /\\gexec/);
});
