#!/usr/bin/env node
/**
 * Unit tests for W1-DATA-04 Prisma↔SQL catalog drift gate (COMPLETE).
 * Run with: node --test tools/scripts/check-prisma-sql-drift.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  AUTHORITY_REL,
  CRITICAL_SQL_BACKED_MODELS,
  buildSqlCatalog,
  camelToSnake,
  defaultsCompatible,
  evaluateDrift,
  extractCreatedTables,
  extractTableColumns,
  normalizeType,
  parseColumnFragment,
  parsePrismaModels,
  takeSqlType,
  typesCompatible,
} from './check-prisma-sql-drift.mjs';

const SAMPLE_PRISMA = `
enum BoardType {
  NATIONAL
  STATE
  PRIVATE
}

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
  @@index([tenantId, userId])
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
  @@index([tenantId, userId])
  @@map("user_sessions")
}

model Tenant {
  id        String    @id @db.Uuid
  name      String    @db.VarChar(255)
  slug      String    @unique @db.VarChar(100)
  config    Json?     @default("{}") @db.JsonB
  status    String    @default("active") @db.VarChar(20)
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")
  refreshTokens RefreshToken[]
  sessions      UserSession[]
  boards        Board[]
  @@map("tenants")
}

model Board {
  id       String    @id @db.Uuid
  tenantId String    @map("tenant_id") @db.Uuid
  name     String    @db.VarChar(255)
  code     String    @db.VarChar(50)
  type     BoardType
  status   String    @default("active") @db.VarChar(20)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")
  tenant   Tenant    @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, code])
  @@index([tenantId, type])
  @@map("boards")
}
`;

const SAMPLE_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  config JSONB DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id               UUID PRIMARY KEY,
  user_id          UUID NOT NULL,
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN NOT NULL,
  user_agent       VARCHAR(500),
  ip_address       VARCHAR(45),
  invalidated_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_sessions_tenant_id_user_id_idx
  ON user_sessions (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY,
  token      VARCHAR(255) NOT NULL,
  user_id    UUID NOT NULL,
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  session_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT refresh_tokens_token_key UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS refresh_tokens_tenant_id_user_id_idx
  ON refresh_tokens (tenant_id, user_id);

CREATE TYPE board_type AS ENUM ('NATIONAL', 'STATE', 'PRIVATE');
CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  type board_type NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS boards_tenant_type_idx ON boards (tenant_id, type);
`;

const README_OK = `# Database — canonical apply order

## Schema authority (W1-DATA-04)

Prisma first, then numbered SQL via apply-sql.sh.
`;

const APPLY_OK = `# Apply numbered domain SQL under db/sql/ (after Prisma migrate deploy).
# prisma:migrate:deploy then this script.
`;

const AUTHORITY_OK = {
  version: 1,
  tables: {
    tenants: { authority: 'sql', mirrorOk: true },
    refresh_tokens: { authority: 'sql' },
    user_sessions: { authority: 'sql' },
    boards: { authority: 'sql' },
  },
};

function withAuthority(reportInput) {
  return {
    ...reportInput,
    authorityManifest: { ok: true, error: null, tables: AUTHORITY_OK.tables },
  };
}

test('camelToSnake converts Prisma field names', () => {
  assert.equal(camelToSnake('userId'), 'user_id');
  assert.equal(camelToSnake('lastActivityAt'), 'last_activity_at');
  assert.equal(camelToSnake('token'), 'token');
});

test('normalizeType and typesCompatible handle practical families', () => {
  assert.equal(normalizeType('TIMESTAMP WITH TIME ZONE'), 'timestamptz');
  assert.equal(normalizeType('INT'), 'integer');
  assert.ok(typesCompatible('timestamp', 'timestamptz'));
  assert.ok(typesCompatible('varchar(255)', 'VARCHAR(255)'));
  assert.equal(typesCompatible('varchar(255)', 'varchar(100)'), false);
  assert.ok(defaultsCompatible('now()', 'NOW()'));
  assert.ok(defaultsCompatible('false', 'FALSE'));
  assert.equal(defaultsCompatible('false', null), false);
});

test('takeSqlType does not swallow NOT NULL / DEFAULT', () => {
  const taken = takeSqlType('UUID NOT NULL DEFAULT uuid_generate_v4()');
  assert.equal(taken.type, 'uuid');
  assert.match(taken.rest, /NOT NULL/i);
  const col = parseColumnFragment('id UUID NOT NULL DEFAULT uuid_generate_v4()');
  assert.equal(col.type, 'uuid');
  assert.equal(col.nullable, false);
  assert.ok(col.defaultExpr);
});

test('parsePrismaModels extracts tables, scalars, indexes, FKs (skips relations)', () => {
  const models = parsePrismaModels(SAMPLE_PRISMA);
  const refresh = models.find((m) => m.name === 'RefreshToken');
  assert.ok(refresh);
  assert.equal(refresh.table, 'refresh_tokens');
  assert.ok(refresh.columns.includes('user_id'));
  assert.ok(refresh.columns.includes('token'));
  assert.ok(!refresh.columns.includes('tenant'));
  assert.ok(refresh.indexes.some((i) => i.columns.join(',') === 'tenant_id,user_id'));
  assert.ok(refresh.foreignKeys.some((fk) => fk.refTable === 'tenants'));
  const board = models.find((m) => m.name === 'Board');
  assert.equal(board.fields.find((f) => f.column === 'type').pgType, 'board_type');
});

test('extractCreatedTables and extractTableColumns parse SQL DDL including ALTER ADD', () => {
  const tables = extractCreatedTables(SAMPLE_SQL);
  assert.ok(tables.has('refresh_tokens'));
  assert.ok(tables.has('user_sessions'));
  const cols = extractTableColumns(SAMPLE_SQL, 'user_sessions');
  assert.ok(cols.has('last_activity_at'));
  assert.ok(cols.has('tenant_id'));

  const withAlter = `${SAMPLE_SQL}\nALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);\n`;
  const altered = extractTableColumns(withAlter, 'tenants');
  assert.ok(altered.has('timezone'));
});

test('buildSqlCatalog captures PK/unique/FK/index/check', () => {
  const cat = buildSqlCatalog(`
    CREATE TABLE t (
      id UUID NOT NULL,
      tenant_id UUID NOT NULL REFERENCES tenants(id),
      status TEXT NOT NULL CHECK (status IN ('a','b')),
      CONSTRAINT t_pkey PRIMARY KEY (id),
      UNIQUE (tenant_id, status)
    );
    CREATE INDEX t_tenant_idx ON t (tenant_id);
  `);
  const t = cat.get('t');
  assert.deepEqual(t.primaryKey, ['id']);
  assert.ok(t.uniques.some((u) => u.join(',') === 'tenant_id,status'));
  assert.ok(t.foreignKeys.some((fk) => fk.columns[0] === 'tenant_id' && fk.refTable === 'tenants'));
  assert.ok(t.indexes.some((i) => i.columns.join(',') === 'tenant_id'));
  assert.ok(t.checks.length >= 1);
});

test('evaluateDrift passes when critical auth tables/columns exist in SQL', () => {
  const report = evaluateDrift(
    withAuthority({
      root: '/tmp/virtual-repo',
      prismaSchemaText: SAMPLE_PRISMA,
      combinedSql: SAMPLE_SQL,
      domainSql: SAMPLE_SQL,
      applySqlText: APPLY_OK,
      dbReadmeText: README_OK,
    }),
  );
  assert.equal(report.ok, true, report.errors.join('; '));
  assert.ok(report.modelsChecked >= 3);
  assert.deepEqual(
    report.criticalModels,
    CRITICAL_SQL_BACKED_MODELS.map((c) => c.model),
  );
  assert.ok(report.parity?.index);
});

test('evaluateDrift fails when critical table missing from db/sql', () => {
  const domainWithoutAuth = `
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  config JSONB DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  type board_type NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS boards_tenant_type_idx ON boards (tenant_id, type);
`;
  const report = evaluateDrift(
    withAuthority({
      root: '/tmp/virtual-repo',
      prismaSchemaText: SAMPLE_PRISMA,
      combinedSql: SAMPLE_SQL,
      domainSql: domainWithoutAuth,
      applySqlText: APPLY_OK,
      dbReadmeText: README_OK,
    }),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /refresh_tokens/.test(e) && /db\/sql/.test(e)));
});

test('evaluateDrift fails when Prisma column missing from SQL', () => {
  const sqlMissingCol = SAMPLE_SQL.replace(/user_agent\s+VARCHAR\(500\),?\n/, '');
  const report = evaluateDrift(
    withAuthority({
      root: '/tmp/virtual-repo',
      prismaSchemaText: SAMPLE_PRISMA,
      combinedSql: sqlMissingCol,
      domainSql: sqlMissingCol,
      applySqlText: APPLY_OK,
      dbReadmeText: README_OK,
    }),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /user_agent/.test(e)));
});

test('evaluateDrift fails on type / nullability / index / FK drift', () => {
  const sqlBadType = SAMPLE_SQL.replace(
    /token\s+VARCHAR\(255\)\s+NOT NULL/,
    'token INTEGER NOT NULL',
  );
  const typeReport = evaluateDrift(
    withAuthority({
      root: '/tmp/virtual-repo',
      prismaSchemaText: SAMPLE_PRISMA,
      combinedSql: sqlBadType,
      domainSql: sqlBadType,
      applySqlText: APPLY_OK,
      dbReadmeText: README_OK,
    }),
  );
  assert.equal(typeReport.ok, false);
  assert.ok(typeReport.errors.some((e) => /type drift/.test(e) && /token/.test(e)));

  const sqlMissingIdx = SAMPLE_SQL.replace(
    /CREATE INDEX IF NOT EXISTS boards_tenant_type_idx ON boards \(tenant_id, type\);/,
    '',
  );
  const idxReport = evaluateDrift(
    withAuthority({
      root: '/tmp/virtual-repo',
      prismaSchemaText: SAMPLE_PRISMA,
      combinedSql: sqlMissingIdx,
      domainSql: sqlMissingIdx,
      applySqlText: APPLY_OK,
      dbReadmeText: README_OK,
    }),
  );
  assert.equal(idxReport.ok, false);
  assert.ok(idxReport.errors.some((e) => /INDEX/.test(e) && /boards/.test(e)));
});

test('evaluateDrift fails when Prisma model has no CREATE TABLE anywhere', () => {
  const prismaExtra = `${SAMPLE_PRISMA}
model OrphanThing {
  id String @id @db.Uuid
  @@map("orphan_things")
}
`;
  const report = evaluateDrift(
    withAuthority({
      root: '/tmp/virtual-repo',
      prismaSchemaText: prismaExtra,
      combinedSql: SAMPLE_SQL,
      domainSql: SAMPLE_SQL,
      applySqlText: APPLY_OK,
      dbReadmeText: README_OK,
    }),
  );
  assert.equal(report.ok, false);
  assert.ok(
    report.errors.some(
      (e) => /orphan_things/.test(e) && (/CREATE TABLE/.test(e) || /authority/.test(e)),
    ),
  );
});

test('evaluateDrift fails without schema authority docs', () => {
  const report = evaluateDrift(
    withAuthority({
      root: '/tmp/virtual-repo',
      prismaSchemaText: SAMPLE_PRISMA,
      combinedSql: SAMPLE_SQL,
      domainSql: SAMPLE_SQL,
      applySqlText: APPLY_OK,
      dbReadmeText: '# Database\n\nNo authority note.\n',
    }),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /schema authority/i.test(e)));
});

test('evaluateDrift fails when authority manifest omits a Prisma table', () => {
  const report = evaluateDrift({
    root: '/tmp/virtual-repo',
    prismaSchemaText: SAMPLE_PRISMA,
    combinedSql: SAMPLE_SQL,
    domainSql: SAMPLE_SQL,
    applySqlText: APPLY_OK,
    dbReadmeText: README_OK,
    authorityManifest: {
      ok: true,
      error: null,
      tables: {
        tenants: { authority: 'sql' },
        refresh_tokens: { authority: 'sql' },
        user_sessions: { authority: 'sql' },
        // boards omitted
      },
    },
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /boards/.test(e) && /authority/.test(e)));
});

test('evaluateDrift fails on dual CREATE without mirrorOk', () => {
  const prismaSql = `CREATE TABLE tenants (id UUID PRIMARY KEY, name TEXT, slug TEXT UNIQUE, config JSONB, status TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ);`;
  const domainSql = SAMPLE_SQL;
  const report = evaluateDrift({
    root: '/tmp/virtual-repo',
    prismaSchemaText: SAMPLE_PRISMA,
    combinedSql: prismaSql + '\n' + domainSql,
    domainSql,
    prismaSql,
    applySqlText: APPLY_OK,
    dbReadmeText: README_OK,
    authorityManifest: {
      ok: true,
      error: null,
      tables: {
        tenants: { authority: 'prisma' }, // no mirrorOk
        refresh_tokens: { authority: 'sql' },
        user_sessions: { authority: 'sql' },
        boards: { authority: 'sql' },
      },
    },
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /mirrorOk/i.test(e)));
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
  writeFileSync(
    join(root, AUTHORITY_REL),
    JSON.stringify(AUTHORITY_OK, null, 2),
  );
  writeFileSync(
    join(root, 'packages/shared/database/prisma/migrations/m1/migration.sql'),
    'CREATE TABLE tenants (id UUID PRIMARY KEY, name VARCHAR(255), slug VARCHAR(100) UNIQUE, config JSONB, status VARCHAR(20), created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ);\n',
  );

  // tenants dual-created — authority must allow mirror
  const authority = {
    ...AUTHORITY_OK,
    tables: {
      ...AUTHORITY_OK.tables,
      tenants: { authority: 'prisma', mirrorOk: true, reason: 'test' },
    },
  };
  writeFileSync(join(root, AUTHORITY_REL), JSON.stringify(authority, null, 2));

  const report = evaluateDrift({ root });
  assert.equal(report.ok, true, report.errors.join('; '));
});
