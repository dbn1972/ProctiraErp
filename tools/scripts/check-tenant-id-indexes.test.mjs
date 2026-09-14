#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-16 leading tenant_id index gate.
 * Run with: node --test tools/scripts/check-tenant-id-indexes.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  evaluateTenantIdIndexes,
  extractLeadingTenantIdCoverage,
  extractTenantScopedTables,
  loadAllowlist,
} from './check-tenant-id-indexes.mjs';

const GOOD_SQL = `
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS students_tenant_idx ON students (tenant_id, name);

CREATE TABLE IF NOT EXISTS enrollments (
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  PRIMARY KEY (tenant_id, student_id)
);
`;

const BAD_SQL = `
CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  enabled BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS report_schedules_due_idx
  ON report_schedules (enabled);

CREATE TABLE IF NOT EXISTS control_plane_documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  tenant_id TEXT,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS control_plane_documents_tenant_idx
  ON control_plane_documents (collection, tenant_id);
`;

function writeFixture({ sql = GOOD_SQL, allowlist = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tenant-idx-gate-'));
  mkdirSync(join(root, 'db/sql'), { recursive: true });
  mkdirSync(join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(join(root, 'packages/shared/database/prisma/migrations'), { recursive: true });
  writeFileSync(join(root, 'db/sql/001_fixture.sql'), sql);
  writeFileSync(
    join(root, 'tools/scripts/tenant-id-index-allowlist.json'),
    JSON.stringify({ allowlist }, null, 2),
  );
  return root;
}

test('extractTenantScopedTables finds CREATE TABLE and ADD COLUMN', () => {
  const tables = extractTenantScopedTables(`
CREATE TABLE a (id INT, tenant_id UUID NOT NULL);
ALTER TABLE b ADD COLUMN IF NOT EXISTS tenant_id UUID;
CREATE TABLE c (id INT);
`);
  assert.deepEqual([...tables].sort(), ['a', 'b']);
});

test('extractLeadingTenantIdCoverage requires leading tenant_id', () => {
  const covered = extractLeadingTenantIdCoverage(BAD_SQL + '\n' + GOOD_SQL);
  assert.equal(covered.has('students'), true);
  assert.equal(covered.has('enrollments'), true);
  assert.equal(covered.has('report_schedules'), false);
  assert.equal(covered.has('control_plane_documents'), false);
});

test('extractLeadingTenantIdCoverage accepts dynamic FOREACH ARRAY indexes', () => {
  const sql = `
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bell_periods', 'parent_messages']
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)', t || '_tenant_idx', t);
  END LOOP;
END $$;
`;
  const covered = extractLeadingTenantIdCoverage(sql);
  assert.equal(covered.has('bell_periods'), true);
  assert.equal(covered.has('parent_messages'), true);
});

test('evaluateTenantIdIndexes passes a complete fixture', () => {
  const root = writeFixture();
  const report = evaluateTenantIdIndexes({ root });
  assert.equal(report.ok, true, report.failures.join('; '));
  assert.equal(report.missing.length, 0);
  assert.ok(report.tenantTableCount >= 2);
});

test('evaluateTenantIdIndexes fails when leading tenant_id index is missing', () => {
  const root = writeFixture({ sql: BAD_SQL });
  const report = evaluateTenantIdIndexes({ root });
  assert.equal(report.ok, false);
  assert.ok(report.missing.includes('report_schedules'));
  assert.ok(report.missing.includes('control_plane_documents'));
});

test('evaluateTenantIdIndexes respects documented allowlist', () => {
  const root = writeFixture({
    sql: BAD_SQL,
    allowlist: [
      {
        table: 'report_schedules',
        reason: 'fixture-only exemption for unit test',
      },
      {
        table: 'control_plane_documents',
        reason: 'fixture-only exemption for unit test',
      },
    ],
  });
  const report = evaluateTenantIdIndexes({ root });
  assert.equal(report.ok, true, report.failures.join('; '));
  assert.equal(report.missing.length, 0);
  assert.equal(report.allowlistCount, 2);
});

test('loadAllowlist rejects entries without reasons', () => {
  const root = writeFixture();
  const path = join(root, 'tools/scripts/tenant-id-index-allowlist.json');
  writeFileSync(path, JSON.stringify({ allowlist: [{ table: 'x' }] }));
  assert.throws(() => loadAllowlist(path), /missing reason/);
});

test('repo corpus currently satisfies the invariant (or documents allowlist)', () => {
  // Integration smoke against the real checkout that owns this test file.
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const report = evaluateTenantIdIndexes({ root });
  assert.equal(
    report.ok,
    true,
    `repo residual: ${report.failures.join('; ')}\nmissing=${report.missing.join(',')}`,
  );
});
