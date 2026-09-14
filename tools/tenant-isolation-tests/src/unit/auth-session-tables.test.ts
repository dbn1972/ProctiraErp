/**
 * W1-DATA-03 — RefreshToken / UserSession SQL tables must not drift from Prisma.
 *
 * Prisma models RefreshToken and UserSession (@@map refresh_tokens / user_sessions)
 * require executable SQL under db/sql/ so apply-sql.sh creates the tables.
 * This unit test guards schema/SQL presence; live catalog checks skip when
 * DATABASE_URL is unset.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATION = '066_auth_session_tables.sql';
const TABLES = ['user_sessions', 'refresh_tokens'] as const;

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../'),
    join(process.cwd(), '../..'),
    process.cwd(),
  ];
  for (const path of candidates) {
    if (
      existsSync(join(path, 'db/sql')) &&
      existsSync(join(path, 'packages/shared/database/prisma/schema.prisma'))
    ) {
      return path;
    }
  }
  throw new Error('Could not locate repo root with db/sql and schema.prisma');
}

function sqlDir(): string {
  return join(repoRoot(), 'db/sql');
}

function loadSql(file: string): string {
  return readFileSync(join(sqlDir(), file), 'utf8');
}

function loadPrismaSchema(): string {
  return readFileSync(
    join(repoRoot(), 'packages/shared/database/prisma/schema.prisma'),
    'utf8',
  );
}

function queryLiveTables(): string[] | null {
  const url = process.env['DATABASE_URL'];
  if (!url) return null;

  const catalogSql =
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('user_sessions', 'refresh_tokens') ORDER BY 1";

  try {
    const out = execSync(`psql "${url}" -v ON_ERROR_STOP=1 -At -c ${JSON.stringify(catalogSql)}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`live auth session catalog query failed: ${message}`);
  }
}

function queryLiveRlsForced():
  | { table: string; rowsecurity: boolean; forcerowsecurity: boolean }[]
  | null {
  const url = process.env['DATABASE_URL'];
  if (!url) return null;

  const catalogSql =
    "SELECT c.relname, c.relrowsecurity::text, c.relforcerowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN ('user_sessions', 'refresh_tokens') ORDER BY 1";

  try {
    const out = execSync(
      `psql "${url}" -v ON_ERROR_STOP=1 -At -F '|' -c ${JSON.stringify(catalogSql)}`,
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return out
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [table, rowsecurity, forcerowsecurity] = line.split('|');
        return {
          table: table!,
          rowsecurity: rowsecurity === 't' || rowsecurity === 'true',
          forcerowsecurity: forcerowsecurity === 't' || forcerowsecurity === 'true',
        };
      });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`live auth session RLS catalog query failed: ${message}`);
  }
}

describe('W1-DATA-03 auth session SQL tables (066_auth_session_tables.sql)', () => {
  it('numbered SQL migration exists under db/sql/', () => {
    const files = readdirSync(sqlDir());
    expect(files).toContain(MIGRATION);
  });

  it('Prisma RefreshToken and UserSession models map to refresh_tokens / user_sessions', () => {
    const prisma = loadPrismaSchema();
    expect(prisma).toMatch(/model RefreshToken\s*\{[\s\S]*?@@map\("refresh_tokens"\)/);
    expect(prisma).toMatch(/model UserSession\s*\{[\s\S]*?@@map\("user_sessions"\)/);
  });

  it('SQL creates both tables with tenant_id FK, indexes, and FORCE RLS tenant_isolation', () => {
    const sql = loadSql(MIGRATION);

    for (const table of TABLES) {
      const ddl = sql.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`),
      );
      expect(ddl, `missing CREATE TABLE for ${table}`).not.toBeNull();
      expect(ddl?.[1]).toMatch(/tenant_id\s+UUID NOT NULL REFERENCES tenants\(id\)/);
      expect(ddl?.[1]).toMatch(/user_id\s+UUID NOT NULL/);

      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
      expect(sql).toMatch(
        new RegExp(
          `CREATE POLICY tenant_isolation ON ${table}[\\s\\S]*?USING \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)[\\s\\S]*?WITH CHECK \\(tenant_id::text = NULLIF\\(current_setting\\('app\\.tenant_id', true\\), ''\\)\\)`,
        ),
      );
    }

    expect(sql).toMatch(/session_id\s+UUID NOT NULL REFERENCES user_sessions\(id\)/);
    expect(sql).toMatch(/CONSTRAINT refresh_tokens_token_key UNIQUE \(token\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS user_sessions_tenant_id_user_id_idx/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS refresh_tokens_tenant_id_session_id_idx/);
  });

  it('live catalog: user_sessions and refresh_tokens exist with FORCE RLS when DATABASE_URL is set', () => {
    const present = queryLiveTables();
    if (present === null) return;

    expect(present.sort()).toEqual(['refresh_tokens', 'user_sessions']);

    const rls = queryLiveRlsForced();
    expect(rls).not.toBeNull();
    for (const row of rls!) {
      expect(row.rowsecurity, `${row.table} missing ENABLE RLS`).toBe(true);
      expect(row.forcerowsecurity, `${row.table} missing FORCE RLS`).toBe(true);
    }
  });
});
