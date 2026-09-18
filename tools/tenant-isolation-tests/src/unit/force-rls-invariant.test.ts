/**
 * W1-DATA-02 — final RLS catalog recurrence guard.
 *
 * Postgres RLS is bypassable by table owners unless FORCE ROW LEVEL SECURITY is
 * set. The catalog model below applies numbered SQL in the same bytewise/C
 * filename order as apply-sql.sh, so a catch-all repair only covers tables that
 * exist at that point. It also tracks tenant tables and policy replacement so a
 * later migration cannot hide behind the 021/051 catch-all migrations.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const INVARIANT_MIGRATION = '051_force_rls_invariant.sql';
const WAVE7_FORCE_MIGRATION = '021_wave7_integrity_schema.sql';
const SAFE_DENY_MIGRATION = '095_w1_data_02_rls_safe_deny.sql';

const REGRESSED_047_POLICIES = [
  {
    table: 'academic_rollover_runs',
    policy: 'academic_rollover_runs_tenant',
  },
  { table: 'lms_modules', policy: 'lms_modules_tenant' },
  { table: 'lms_module_items', policy: 'lms_module_items_tenant' },
] as const;

interface MigrationSql {
  file: string;
  sql: string;
}

interface PolicyState {
  file: string;
  statement: string;
}

interface TableRlsState {
  enabled: boolean;
  forced: boolean;
  tenantOwned: boolean;
  lastFile: string;
  policies: Map<string, PolicyState>;
}

type CatalogRequirement = 'ENABLE' | 'FORCE' | 'policy';

interface CatalogOffender {
  file: string;
  table: string;
  missing: CatalogRequirement[];
}

type RlsEventKind =
  | 'tenant-table'
  | 'drop-table'
  | 'enable'
  | 'disable'
  | 'force'
  | 'no-force'
  | 'force-all'
  | 'create-policy'
  | 'drop-policy';

interface RlsEvent {
  index: number;
  kind: RlsEventKind;
  table?: string;
  policy?: string;
  statement?: string;
}

function sqlDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql'),
    join(process.cwd(), 'db/sql'),
    join(process.cwd(), '../../db/sql'),
  ];
  for (const path of candidates) {
    try {
      readdirSync(path);
      return path;
    } catch {
      // try next
    }
  }
  throw new Error('Could not locate db/sql/');
}

function loadSql(file: string): string {
  return readFileSync(join(sqlDir(), file), 'utf8');
}

/** ASCII migration names compare the same way as LC_ALL=C sort in apply-sql.sh. */
function compareC(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function listNumberedSqlFiles(): string[] {
  return readdirSync(sqlDir())
    .filter((file) => /^[0-9].*\.sql$/.test(file))
    .sort(compareC);
}

function loadNumberedMigrations(): MigrationSql[] {
  return listNumberedSqlFiles().map((file) => ({ file, sql: loadSql(file) }));
}

/** Matches 021 / 051 style loops over pg_catalog that FORCE all current RLS tables. */
function hasForceAllRlsDoBlock(sql: string): boolean {
  return (
    /FORCE ROW LEVEL SECURITY/i.test(sql) &&
    /rowsecurity\s*=\s*true/i.test(sql) &&
    /(pg_tables|pg_class)/i.test(sql)
  );
}

function tableName(raw: string): string {
  return raw.replaceAll('"', '').toLowerCase();
}

function extractRlsEvents(sql: string): RlsEvent[] {
  const events: RlsEvent[] = [];

  const createTablePattern =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\)\s*;/gi;
  for (const match of sql.matchAll(createTablePattern)) {
    if (/\btenant_id\b/i.test(match[2]!)) {
      events.push({
        index: match.index,
        kind: 'tenant-table',
        table: tableName(match[1]!),
      });
    }
  }

  const addTenantColumnPattern =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?[\s\S]*?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?tenant_id"?\b[\s\S]*?;/gi;
  for (const match of sql.matchAll(addTenantColumnPattern)) {
    events.push({
      index: match.index,
      kind: 'tenant-table',
      table: tableName(match[1]!),
    });
  }

  const dropTablePattern =
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?[^;]*;/gi;
  for (const match of sql.matchAll(dropTablePattern)) {
    events.push({
      index: match.index,
      kind: 'drop-table',
      table: tableName(match[1]!),
    });
  }

  const alterRlsPattern =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\s*;/gi;
  for (const match of sql.matchAll(alterRlsPattern)) {
    const action = match[2]!.replace(/\s+/g, ' ').toUpperCase();
    const kind: RlsEventKind =
      action === 'ENABLE'
        ? 'enable'
        : action === 'DISABLE'
          ? 'disable'
          : action === 'FORCE'
            ? 'force'
            : 'no-force';
    events.push({
      index: match.index,
      kind,
      table: tableName(match[1]!),
    });
  }

  const createPolicyPattern =
    /CREATE\s+POLICY\s+"?([a-z_][a-z0-9_]*)"?\s+ON\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?([\s\S]*?);/gi;
  for (const match of sql.matchAll(createPolicyPattern)) {
    events.push({
      index: match.index,
      kind: 'create-policy',
      policy: tableName(match[1]!),
      table: tableName(match[2]!),
      statement: match[0],
    });
  }

  const dropPolicyPattern =
    /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s+ON\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*;/gi;
  for (const match of sql.matchAll(dropPolicyPattern)) {
    events.push({
      index: match.index,
      kind: 'drop-policy',
      policy: tableName(match[1]!),
      table: tableName(match[2]!),
    });
  }

  const doBlockPattern = /DO\s+\$\$[\s\S]*?END\s+\$\$\s*;/gi;
  for (const match of sql.matchAll(doBlockPattern)) {
    const block = match[0];
    if (hasForceAllRlsDoBlock(block)) {
      events.push({ index: match.index, kind: 'force-all' });
      continue;
    }

    // Several historical migrations apply identical RLS DDL to a literal
    // FOREACH table list. Model that executable DDL at this point in the
    // stream; do not treat it as a timeless catch-all for later tables.
    const foreachPattern =
      /FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]\s*LOOP([\s\S]*?)END\s+LOOP\s*;/gi;
    for (const foreachMatch of block.matchAll(foreachPattern)) {
      const loopBody = foreachMatch[2]!;
      if (!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(loopBody)) continue;

      const tables = [...foreachMatch[1]!.matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map((tableMatch) =>
        tableName(tableMatch[1]!),
      );
      const policyName = loopBody.match(/CREATE\s+POLICY\s+([a-z_][a-z0-9_]*)\s+ON\s+%I/i)?.[1];
      const dropsPolicy = loopBody.match(
        /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ON\s+%I/i,
      )?.[1];
      const eventIndex = match.index + foreachMatch.index;

      for (const table of tables) {
        if (/\btenant_id\b/i.test(loopBody)) {
          events.push({ index: eventIndex, kind: 'tenant-table', table });
        }
        events.push({ index: eventIndex + 1, kind: 'enable', table });
        if (/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(loopBody)) {
          events.push({ index: eventIndex + 2, kind: 'force', table });
        }
        if (dropsPolicy) {
          events.push({
            index: eventIndex + 3,
            kind: 'drop-policy',
            table,
            policy: tableName(dropsPolicy),
          });
        }
        if (policyName) {
          events.push({
            index: eventIndex + 4,
            kind: 'create-policy',
            table,
            policy: tableName(policyName),
            statement: loopBody,
          });
        }
      }
    }
  }

  return events.sort((left, right) => left.index - right.index);
}

function buildFinalRlsCatalog(
  migrations: MigrationSql[] = loadNumberedMigrations(),
): Map<string, TableRlsState> {
  const states = new Map<string, TableRlsState>();

  const stateFor = (table: string, file: string): TableRlsState => {
    let state = states.get(table);
    if (!state) {
      state = {
        enabled: false,
        forced: false,
        tenantOwned: false,
        lastFile: file,
        policies: new Map(),
      };
      states.set(table, state);
    }
    state.lastFile = file;
    return state;
  };

  for (const migration of [...migrations].sort((left, right) => compareC(left.file, right.file))) {
    for (const event of extractRlsEvents(migration.sql)) {
      if (event.kind === 'force-all') {
        for (const state of states.values()) {
          if (state.enabled) {
            state.forced = true;
            state.lastFile = migration.file;
          }
        }
        continue;
      }

      const table = event.table!;
      if (event.kind === 'drop-table') {
        states.delete(table);
        continue;
      }

      const state = stateFor(table, migration.file);
      switch (event.kind) {
        case 'tenant-table':
          state.tenantOwned = true;
          break;
        case 'enable':
          state.enabled = true;
          break;
        case 'disable':
          state.enabled = false;
          break;
        case 'force':
          state.forced = true;
          break;
        case 'no-force':
          state.forced = false;
          break;
        case 'create-policy':
          state.tenantOwned ||= /\btenant_id\b/i.test(event.statement!);
          state.policies.set(event.policy!, {
            file: migration.file,
            statement: event.statement!,
          });
          break;
        case 'drop-policy':
          state.policies.delete(event.policy!);
          break;
        default:
          break;
      }
    }
  }

  return states;
}

function staticCatalogOffenders(migrations?: MigrationSql[]): CatalogOffender[] {
  const offenders: CatalogOffender[] = [];

  for (const [table, state] of buildFinalRlsCatalog(migrations)) {
    const missing: CatalogRequirement[] = [];
    if (state.tenantOwned) {
      if (!state.enabled) missing.push('ENABLE');
      if (!state.forced) missing.push('FORCE');
      if (state.policies.size === 0) missing.push('policy');
    } else if (state.enabled && !state.forced) {
      missing.push('FORCE');
    }

    if (missing.length > 0) {
      offenders.push({ file: state.lastFile, table, missing });
    }
  }

  return offenders.sort((left, right) => compareC(left.table, right.table));
}

function compactSql(sql: string): string {
  return sql.toLowerCase().replace(/\s+/g, '');
}

function queryLiveUnforcedRlsTables(): string[] | null {
  const url = process.env['DATABASE_URL'];
  if (!url) return null;

  const catalogSql =
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity = true AND NOT c.relforcerowsecurity ORDER BY 1";

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`live FORCE RLS catalog query failed: ${message}`);
  }
}

describe('W1-DATA-02 final RLS catalog invariant', () => {
  it('keeps 047 immutable as the source of the historical FORCE/cast regressions', () => {
    const sql = loadSql('047_academic_rollover_runs_schema.sql');
    for (const { table } of REGRESSED_047_POLICIES) {
      expect(sql, `${table} must ENABLE RLS in historical 047`).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
      );
      expect(sql, `${table} must not inline FORCE in historical 047`).not.toMatch(
        new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`),
      );
    }
    expect(sql).toContain("current_setting('app.tenant_id', true), '')::uuid");
  });

  it('051 migration applies FORCE to every RLS-enabled public table present at that point', () => {
    const sql = loadSql(INVARIANT_MIGRATION);
    expect(hasForceAllRlsDoBlock(sql)).toBe(true);
    for (const { table } of REGRESSED_047_POLICIES) {
      expect(sql).toMatch(
        new RegExp(
          `(ALTER TABLE IF EXISTS ${table} FORCE ROW LEVEL SECURITY|FOR\\s+\\w+\\s+IN[\\s\\S]*FORCE ROW LEVEL SECURITY)`,
        ),
      );
    }
  });

  it('applies the safe-deny forward fix after 047, 051, 071, and the prior migration tip', () => {
    const files = listNumberedSqlFiles();
    const safeDenyIndex = files.indexOf(SAFE_DENY_MIGRATION);
    expect(safeDenyIndex, `missing ${SAFE_DENY_MIGRATION}`).toBeGreaterThanOrEqual(0);

    for (const predecessor of [
      '047_academic_rollover_runs_schema.sql',
      INVARIANT_MIGRATION,
      '071_tenant_guc_canonical.sql',
      '090_consent_lifecycle_append_only.sql',
    ]) {
      expect(
        safeDenyIndex,
        `${SAFE_DENY_MIGRATION} must sort after ${predecessor}`,
      ).toBeGreaterThan(files.indexOf(predecessor));
    }
  });

  it('static final catalog has no tenant/RLS table missing ENABLE, FORCE, or policy', () => {
    const offenders = staticCatalogOffenders();
    expect(
      offenders,
      offenders.length > 0
        ? `final static RLS catalog offenders: ${offenders
            .map((offender) => `${offender.file}:${offender.table}[${offender.missing.join(',')}]`)
            .join(', ')}`
        : undefined,
    ).toEqual([]);
  });

  it('does not let an earlier catch-all mask tenant tables introduced by later migrations', () => {
    const offenders = staticCatalogOffenders([
      {
        file: INVARIANT_MIGRATION,
        sql: `
          CREATE TABLE baseline (id uuid, tenant_id uuid NOT NULL);
          ALTER TABLE baseline ENABLE ROW LEVEL SECURITY;
          CREATE POLICY baseline_tenant ON baseline
            USING (tenant_id::text = app_tenant_id())
            WITH CHECK (tenant_id::text = app_tenant_id());
          DO $$
          DECLARE t record;
          BEGIN
            FOR t IN SELECT relname FROM pg_class WHERE rowsecurity = true LOOP
              EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.relname);
            END LOOP;
          END $$;
        `,
      },
      {
        file: '092_later_tenant_tables.sql',
        sql: `
          CREATE TABLE late_partial (id uuid, tenant_id uuid NOT NULL);
          ALTER TABLE late_partial ENABLE ROW LEVEL SECURITY;
          CREATE TABLE late_unscoped (id uuid, tenant_id uuid NOT NULL);
        `,
      },
    ]);

    expect(offenders).toEqual([
      {
        file: '092_later_tenant_tables.sql',
        table: 'late_partial',
        missing: ['FORCE', 'policy'],
      },
      {
        file: '092_later_tenant_tables.sql',
        table: 'late_unscoped',
        missing: ['ENABLE', 'FORCE', 'policy'],
      },
    ]);
  });

  it('final 047-target policies use the canonical text-safe helper with WITH CHECK', () => {
    const catalog = buildFinalRlsCatalog();

    for (const { table, policy } of REGRESSED_047_POLICIES) {
      const state = catalog.get(table);
      expect(state, `${table} must exist in the final static catalog`).toBeDefined();
      expect(state!.enabled, `${table} must have ENABLE RLS`).toBe(true);
      expect(state!.forced, `${table} must have FORCE RLS`).toBe(true);
      expect([...state!.policies.keys()], `${table} must retain only its tenant policy`).toEqual([
        policy,
      ]);

      const finalPolicy = state!.policies.get(policy);
      expect(finalPolicy, `${table}.${policy} must exist`).toBeDefined();
      expect(finalPolicy!.file, `${table}.${policy} final definition`).toBe(SAFE_DENY_MIGRATION);

      const compact = compactSql(finalPolicy!.statement);
      expect(compact).toContain('aspermissiveforalltopublic');
      expect(compact).toContain('using(tenant_id::text=app_tenant_id())');
      expect(compact).toContain('withcheck(tenant_id::text=app_tenant_id())');
      expect(compact).not.toContain('current_setting');
      expect(compact).not.toContain('::uuid');
    }
  });

  it('live catalog: every public RLS table has relforcerowsecurity when DATABASE_URL is set', () => {
    const unforced = queryLiveUnforcedRlsTables();
    if (unforced === null) return;

    expect(
      unforced,
      unforced.length > 0
        ? `public tables with RLS enabled but not forced: ${unforced.join(', ')}`
        : undefined,
    ).toEqual([]);
  });
});
