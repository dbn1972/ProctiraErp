#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-04 Prisma↔SQL drift gate.
 * Run with: node --test tools/scripts/check-prisma-sql-drift.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  CRITICAL_SQL_BACKED_MODELS,
  camelToSnake,
  evaluateDrift,
  extractCreatedTables,
  extractTableColumns,
  parsePrismaModels,
} from './check-prisma-sql-drift.mjs';

const SAMPLE_PRISMA = `
model RefreshToken {
  id        String   @id @db.Uuid
  token     String   @unique @db.VarChar(255)
  userId    String   @map("user_id") @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  sessionId String   @map("session_id") @db.Uuid
  expiresAt DateTime @map("expires_at")
  revoked   Boolean  @default(false)
  createdAt DateTime @default(now()) @map("created_at")
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  @@map("refresh_tokens")
}

model UserSession {
  id             String    @id @db.Uuid
  userId         String    @map("user_id") @db.Uuid
  tenantId       String    @map("tenant_id") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at")
  expiresAt      DateTime  @map("expires_at")
  lastActivityAt DateTime  @map("last_activity_at")
  isActive       Boolean   @map("is_active")
  userAgent      String?   @map("user_agent")
  ipAddress      String?   @map("ip_address")
  invalidatedAt  DateTime? @map("invalidated_at")
  refreshTokens  RefreshToken[]
  @@map("user_sessions")
}

model Tenant {
  id   String @id @db.Uuid
  name String
  @@map("tenants")
}
`;

const SAMPLE_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id               UUID PRIMARY KEY,
  user_id          UUID NOT NULL,
  tenant_id        UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN NOT NULL,
  user_agent       VARCHAR(500),
  ip_address       VARCHAR(45),
  invalidated_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY,
  token      VARCHAR(255) NOT NULL,
  user_id    UUID NOT NULL,
  tenant_id  UUID NOT NULL,
  session_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
`;

const README_OK = `# Database — canonical apply order

## Schema authority (W1-DATA-04)

Prisma first, then numbered SQL via apply-sql.sh.
`;

const APPLY_OK = `# Apply numbered domain SQL under db/sql/ (after Prisma migrate deploy).
# prisma:migrate:deploy then this script.
`;

test('camelToSnake converts Prisma field names', () => {
  assert.equal(camelToSnake('userId'), 'user_id');
  assert.equal(camelToSnake('lastActivityAt'), 'last_activity_at');
  assert.equal(camelToSnake('token'), 'token');
});

test('parsePrismaModels extracts tables and scalar columns (skips relations)', () => {
  const models = parsePrismaModels(SAMPLE_PRISMA);
  const refresh = models.find((m) => m.name === 'RefreshToken');
  assert.ok(refresh);
  assert.equal(refresh.table, 'refresh_tokens');
  assert.ok(refresh.columns.includes('user_id'));
  assert.ok(refresh.columns.includes('token'));
  assert.ok(!refresh.columns.includes('tenant'));
});

test('extractCreatedTables and extractTableColumns parse SQL DDL', () => {
  const tables = extractCreatedTables(SAMPLE_SQL);
  assert.ok(tables.has('refresh_tokens'));
  assert.ok(tables.has('user_sessions'));
  const cols = extractTableColumns(SAMPLE_SQL, 'user_sessions');
  assert.ok(cols.has('last_activity_at'));
  assert.ok(cols.has('tenant_id'));
});

test('evaluateDrift passes when critical auth tables/columns exist in SQL', () => {
  const report = evaluateDrift({
    root: '/tmp/virtual-repo',
    prismaSchemaText: SAMPLE_PRISMA,
    combinedSql: SAMPLE_SQL,
    domainSql: SAMPLE_SQL,
    applySqlText: APPLY_OK,
    dbReadmeText: README_OK,
  });
  assert.equal(report.ok, true, report.errors.join('; '));
  assert.ok(report.modelsChecked >= 3);
  assert.deepEqual(
    report.criticalModels,
    CRITICAL_SQL_BACKED_MODELS.map((c) => c.model),
  );
});

test('evaluateDrift fails when critical table missing from db/sql', () => {
  const domainWithoutAuth = `
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL
);
`;
  const report = evaluateDrift({
    root: '/tmp/virtual-repo',
    prismaSchemaText: SAMPLE_PRISMA,
    combinedSql: SAMPLE_SQL,
    domainSql: domainWithoutAuth,
    applySqlText: APPLY_OK,
    dbReadmeText: README_OK,
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /refresh_tokens/.test(e) && /db\/sql/.test(e)));
});

test('evaluateDrift fails when Prisma column missing from SQL', () => {
  const sqlMissingCol = SAMPLE_SQL.replace(/user_agent\s+VARCHAR\(500\),?\n/, '');
  const report = evaluateDrift({
    root: '/tmp/virtual-repo',
    prismaSchemaText: SAMPLE_PRISMA,
    combinedSql: sqlMissingCol,
    domainSql: sqlMissingCol,
    applySqlText: APPLY_OK,
    dbReadmeText: README_OK,
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /user_agent/.test(e)));
});

test('evaluateDrift fails when Prisma model has no CREATE TABLE anywhere', () => {
  const prismaExtra = `${SAMPLE_PRISMA}
model OrphanThing {
  id String @id @db.Uuid
  @@map("orphan_things")
}
`;
  const report = evaluateDrift({
    root: '/tmp/virtual-repo',
    prismaSchemaText: prismaExtra,
    combinedSql: SAMPLE_SQL,
    domainSql: SAMPLE_SQL,
    applySqlText: APPLY_OK,
    dbReadmeText: README_OK,
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /orphan_things/.test(e)));
});

test('evaluateDrift fails without schema authority docs', () => {
  const report = evaluateDrift({
    root: '/tmp/virtual-repo',
    prismaSchemaText: SAMPLE_PRISMA,
    combinedSql: SAMPLE_SQL,
    domainSql: SAMPLE_SQL,
    applySqlText: APPLY_OK,
    dbReadmeText: '# Database\n\nNo authority note.\n',
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /schema authority/i.test(e)));
});

test('repo fixture: gate passes against a minimal on-disk tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'w1-data-04-'));
  mkdirSync(join(root, 'packages/shared/database/prisma/migrations/m1'), { recursive: true });
  mkdirSync(join(root, 'db/sql'), { recursive: true });
  mkdirSync(join(root, 'tools/scripts'), { recursive: true });
  writeFileSync(join(root, 'packages/shared/database/prisma/schema.prisma'), SAMPLE_PRISMA);
  writeFileSync(join(root, 'db/sql/066_auth_session_tables.sql'), SAMPLE_SQL);
  writeFileSync(join(root, 'tools/scripts/apply-sql.sh'), APPLY_OK);
  writeFileSync(join(root, 'db/README.md'), README_OK);
  // Prisma migration also creates tenants (platform layer)
  writeFileSync(
    join(root, 'packages/shared/database/prisma/migrations/m1/migration.sql'),
    'CREATE TABLE tenants (id UUID PRIMARY KEY, name TEXT);\n',
  );

  const report = evaluateDrift({ root });
  assert.equal(report.ok, true, report.errors.join('; '));
});
