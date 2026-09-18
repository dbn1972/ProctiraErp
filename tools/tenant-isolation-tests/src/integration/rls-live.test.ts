/**
 * W1-OPS-06 / W1-DATA-02 — live Postgres RLS release gate.
 *
 * Static raw-SQL contract tests read migration files from disk; this suite
 * proves RLS is enforced by the engine against a fully migrated database.
 * Skips locally when DATABASE_URL is unset; CI provisions Postgres and sets
 * DATABASE_URL in both the live and tenant-isolation gates.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'rls-live.test' });
// APPLY_STRICT_FKS=1 guarantees this parent row through migration 021a/082.
const STRICT_FK_DEMO_TENANT_ID = '00000000-0000-4000-8000-000000000001';

const SAFE_DENY_POLICIES = [
  {
    table: 'academic_rollover_runs',
    policy: 'academic_rollover_runs_tenant',
  },
  { table: 'lms_modules', policy: 'lms_modules_tenant' },
  { table: 'lms_module_items', policy: 'lms_module_items_tenant' },
] as const;

function normalizePolicyExpression(expression: string): string {
  return expression.toLowerCase().replace(/[\s()"]+/g, '');
}

async function expectRlsWriteDeniedWithoutUuidCast(
  label: string,
  action: () => Promise<unknown>,
): Promise<void> {
  let error: unknown;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }

  expect(error, `${label} unexpectedly allowed the write`).toBeDefined();
  expect(
    (error as { code?: string }).code,
    `${label} must deny through RLS (42501), not UUID parsing (22P02)`,
  ).toBe('42501');
}

describe.skipIf(!DATABASE_URL)('Live Postgres RLS release gate', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('connects as NOSUPERUSER NOBYPASSRLS (production RLS posture)', async () => {
    const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(`
      SELECT rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const role = rows[0]!;
    expect(role.rolsuper, 'CI must not connect as a superuser').toBe(false);
    expect(role.rolbypassrls, 'CI must not connect with BYPASSRLS').toBe(false);
  });

  it('every public tenant_id table has ENABLE + FORCE RLS and at least one policy', async () => {
    const { rows } = await pool.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND EXISTS (
          SELECT 1
          FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attname = 'tenant_id'
            AND NOT a.attisdropped
        )
        AND (
          NOT c.relrowsecurity
          OR NOT c.relforcerowsecurity
          OR NOT EXISTS (
            SELECT 1
            FROM pg_policies p
            WHERE p.schemaname = n.nspname
              AND p.tablename = c.relname
          )
        )
      ORDER BY 1
    `);
    expect(
      rows,
      rows.length > 0
        ? `RLS catalog offenders (missing ENABLE/FORCE/policy): ${rows.map((row) => row.table_name).join(', ')}`
        : undefined,
    ).toHaveLength(0);
  });

  it('final 047-target catalog preserves FORCE and text-safe USING/WITH CHECK policies', async () => {
    const { rows } = await pool.query<{
      table_name: string;
      policy_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      permissive: string;
      command: string;
      roles: string;
      using_expression: string | null;
      check_expression: string | null;
      policy_count: number;
    }>(`
      SELECT
        p.tablename AS table_name,
        p.policyname AS policy_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        p.permissive,
        p.cmd AS command,
        array_to_string(p.roles, ',') AS roles,
        p.qual AS using_expression,
        p.with_check AS check_expression,
        (
          SELECT count(*)::int
          FROM pg_policies all_policies
          WHERE all_policies.schemaname = p.schemaname
            AND all_policies.tablename = p.tablename
        ) AS policy_count
      FROM pg_policies p
      JOIN pg_namespace n ON n.nspname = p.schemaname
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = p.tablename
      WHERE p.schemaname = 'public'
        AND (p.tablename, p.policyname) IN (
          ('academic_rollover_runs', 'academic_rollover_runs_tenant'),
          ('lms_modules', 'lms_modules_tenant'),
          ('lms_module_items', 'lms_module_items_tenant')
        )
      ORDER BY p.tablename
    `);

    expect(rows).toHaveLength(SAFE_DENY_POLICIES.length);
    for (const expectedPolicy of SAFE_DENY_POLICIES) {
      const row = rows.find(
        (candidate) =>
          candidate.table_name === expectedPolicy.table &&
          candidate.policy_name === expectedPolicy.policy,
      );
      if (!row) {
        throw new Error(`missing ${expectedPolicy.table}.${expectedPolicy.policy}`);
      }

      expect(row.rls_enabled, `${row.table_name} ENABLE RLS`).toBe(true);
      expect(row.rls_forced, `${row.table_name} FORCE RLS`).toBe(true);
      expect(row.permissive).toBe('PERMISSIVE');
      expect(row.command).toBe('ALL');
      expect(row.roles).toBe('public');
      expect(row.policy_count, `${row.table_name} must not have a permissive bypass policy`).toBe(
        1,
      );
      expect(row.using_expression, `${row.table_name} USING expression`).not.toBeNull();
      expect(row.check_expression, `${row.table_name} WITH CHECK expression`).not.toBeNull();
      expect(normalizePolicyExpression(row.using_expression!)).toBe(
        'tenant_id::text=app_tenant_id',
      );
      expect(normalizePolicyExpression(row.check_expression!)).toBe(
        'tenant_id::text=app_tenant_id',
      );
      expect(row.using_expression!.toLowerCase()).not.toContain('::uuid');
      expect(row.check_expression!.toLowerCase()).not.toContain('::uuid');
      expect(row.using_expression!.toLowerCase()).not.toContain('current_setting');
      expect(row.check_expression!.toLowerCase()).not.toContain('current_setting');
    }
  });

  it('047-target reads safely deny cross-tenant, unscoped, and non-UUID contexts', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const rolloverId = randomUUID();
    const moduleId = randomUUID();
    const moduleItemId = randomUUID();
    const malformedRolloverId = randomUUID();
    const malformedModuleId = randomUUID();
    const malformedModuleItemId = randomUUID();
    const targetRows = [
      { table: 'academic_rollover_runs', id: rolloverId },
      { table: 'lms_modules', id: moduleId },
      { table: 'lms_module_items', id: moduleItemId },
    ] as const;

    // Strict tenant FKs reject these child rows unless the tenant parent exists.
    // tenantB stays uncreated on purpose: it is only ever a read context.
    await ensurePgTestTenant(pool, tenantA);

    try {
      await withPgTenant(pool, tenantA, async (client) => {
        await client.query(
          `INSERT INTO academic_rollover_runs
             (id, tenant_id, source_period_id, target_period_id, actor_id, status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'w1-data-02', 'completed')`,
          [rolloverId, tenantA, randomUUID(), randomUUID()],
        );
        await client.query(
          `INSERT INTO lms_modules (id, tenant_id, title)
           VALUES ($1::uuid, $2::uuid, 'W1-DATA-02 safe deny')`,
          [moduleId, tenantA],
        );
        await client.query(
          `INSERT INTO lms_module_items
             (id, tenant_id, module_id, item_type, title)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'content', 'W1-DATA-02 item')`,
          [moduleItemId, tenantA, moduleId],
        );
      });

      await withPgTenant(pool, tenantA, async (client) => {
        for (const target of targetRows) {
          const result = await client.query(
            `SELECT id::text FROM ${target.table} WHERE id = $1::uuid`,
            [target.id],
          );
          expect(result.rows, `${target.table} must be visible to its tenant`).toHaveLength(1);
        }
      });

      await expect(
        withPgTenant(pool, tenantB, async (client) => {
          for (const target of targetRows) {
            const result = await client.query(
              `SELECT id::text FROM ${target.table} WHERE id = $1::uuid`,
              [target.id],
            );
            expect(result.rows, `${target.table} cross-tenant read`).toHaveLength(0);
          }
        }),
      ).resolves.toBeUndefined();

      await expect(
        (async () => {
          for (const target of targetRows) {
            const result = await pool.query(
              `SELECT id::text FROM ${target.table} WHERE id = $1::uuid`,
              [target.id],
            );
            expect(result.rows, `${target.table} unscoped read`).toHaveLength(0);
          }
        })(),
      ).resolves.toBeUndefined();

      await expect(
        withPgTenant(pool, 'not-a-uuid', async (client) => {
          for (const target of targetRows) {
            const result = await client.query(
              `SELECT id::text FROM ${target.table} WHERE id = $1::uuid`,
              [target.id],
            );
            expect(result.rows, `${target.table} malformed-context read`).toHaveLength(0);
          }
        }),
      ).resolves.toBeUndefined();

      await expectRlsWriteDeniedWithoutUuidCast('academic_rollover_runs WITH CHECK', () =>
        withPgTenant(pool, 'not-a-uuid', (client) =>
          client.query(
            `INSERT INTO academic_rollover_runs
               (id, tenant_id, source_period_id, target_period_id, actor_id, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'w1-data-02', 'completed')`,
            [malformedRolloverId, tenantA, randomUUID(), randomUUID()],
          ),
        ),
      );
      await expectRlsWriteDeniedWithoutUuidCast('lms_modules WITH CHECK', () =>
        withPgTenant(pool, 'not-a-uuid', (client) =>
          client.query(
            `INSERT INTO lms_modules (id, tenant_id, title)
             VALUES ($1::uuid, $2::uuid, 'W1-DATA-02 malformed context')`,
            [malformedModuleId, tenantA],
          ),
        ),
      );
      await expectRlsWriteDeniedWithoutUuidCast('lms_module_items WITH CHECK', () =>
        withPgTenant(pool, 'not-a-uuid', (client) =>
          client.query(
            `INSERT INTO lms_module_items
               (id, tenant_id, module_id, item_type, title)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'content', 'malformed context')`,
            [malformedModuleItemId, tenantA, moduleId],
          ),
        ),
      );
    } finally {
      await withPgTenant(pool, tenantA, async (client) => {
        await client.query(`DELETE FROM lms_modules WHERE id IN ($1::uuid, $2::uuid)`, [
          moduleId,
          malformedModuleId,
        ]);
        await client.query(`DELETE FROM academic_rollover_runs WHERE id IN ($1::uuid, $2::uuid)`, [
          rolloverId,
          malformedRolloverId,
        ]);
      });
    }
  });

  it('cross-tenant rows are invisible when app.tenant_id is bound (hostels smoke)', async () => {
    const tenantA = STRICT_FK_DEMO_TENANT_ID;
    const tenantB = randomUUID();
    const hostelId = randomUUID();
    const code = `w1ops06-${hostelId.slice(0, 8)}`;

    await withPgTenant(pool, tenantA, async (client) => {
      await client.query(
        `INSERT INTO hostels (id, tenant_id, name, code, capacity, status)
         VALUES ($1::uuid, $2::uuid, 'Gate A', $3, 10, 'active')`,
        [hostelId, tenantA, code],
      );
    });

    const seenByA = await withPgTenant(pool, tenantA, async (client) => {
      const result = await client.query(`SELECT id::text FROM hostels WHERE id = $1::uuid`, [
        hostelId,
      ]);
      return result.rows as Array<{ id: string }>;
    });
    expect(seenByA).toHaveLength(1);

    const seenByB = await withPgTenant(pool, tenantB, async (client) => {
      const result = await client.query(`SELECT id::text FROM hostels WHERE id = $1::uuid`, [
        hostelId,
      ]);
      return result.rows as Array<{ id: string }>;
    });
    expect(seenByB).toHaveLength(0);

    const unscoped = await pool.query(`SELECT id::text FROM hostels WHERE id = $1::uuid`, [
      hostelId,
    ]);
    expect(unscoped.rowCount).toBe(0);

    await withPgTenant(pool, tenantA, async (client) => {
      await client.query(`DELETE FROM hostels WHERE id = $1::uuid`, [hostelId]);
    });
  });
});
