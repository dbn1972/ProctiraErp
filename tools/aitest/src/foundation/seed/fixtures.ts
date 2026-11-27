/**
 * Fixture manifest (program plan D7): real ids sampled from the seeded
 * throwaway database, so harnesses resolve route params from data instead of
 * hand-kept ids. Read as the bootstrap superuser in a READ ONLY transaction.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { ident, listTenantTablesWithId, withPg } from '../db/pg.js';
import { stackDbUrls } from '../stack/state.js';
import type { StackState } from '../stack/types.js';

import { TENANT_KEYS, TENANTS, type TenantKey } from './tenants.js';

export interface FixtureManifest {
  generatedAt: string;
  gitSha: string;
  tenants: Record<TenantKey, { id: string; slug: string; status: string; institutions: string[] }>;
  /** table → tenant → up to `perTable` ids (ordered by id). */
  ids: Record<string, Partial<Record<TenantKey, string[]>>>;
  principals: {
    /** parent_child_links.parent_user_id (active links). */
    guardians: Partial<Record<TenantKey, string[]>>;
    /** students.custom_data.user_id self-bindings (PRC-H075). */
    students: Partial<Record<TenantKey, Array<{ sub: string; studentId: string }>>>;
  };
}

export async function buildFixtureManifest(
  s: StackState,
  o: { perTable?: number } = {},
): Promise<FixtureManifest> {
  const perTable = o.perTable ?? 5;
  const byId = new Map(TENANT_KEYS.map((k) => [TENANTS[k].id, k] as const));
  const tenantIds = TENANT_KEYS.map((k) => TENANTS[k].id);
  return withPg(stackDbUrls(s).bootstrap, async (c) => {
    await c.query('BEGIN READ ONLY');
    try {
      const tenants = {} as FixtureManifest['tenants'];
      const rows = await c.query<{ id: string; slug: string; status: string }>(
        'SELECT id::text, slug, status FROM tenants WHERE id::text = ANY($1)',
        [tenantIds],
      );
      for (const k of TENANT_KEYS) {
        const row = rows.rows.find((r) => r.id === TENANTS[k].id);
        tenants[k] = {
          id: TENANTS[k].id,
          slug: row?.slug ?? TENANTS[k].slug,
          status: row?.status ?? 'missing',
          institutions: [],
        };
      }
      const inst = await c.query<{ tenant_id: string; id: string }>(
        `SELECT tenant_id::text, id::text FROM institutions
          WHERE tenant_id::text = ANY($1) AND deleted_at IS NULL ORDER BY id`,
        [tenantIds],
      );
      for (const r of inst.rows) {
        const k = byId.get(r.tenant_id);
        if (k) tenants[k].institutions.push(r.id);
      }

      const ids: FixtureManifest['ids'] = {};
      for (const table of await listTenantTablesWithId(c)) {
        if (table === 'tenants') continue;
        const t = ident(table);
        await c.query('SAVEPOINT fx');
        let r;
        try {
          r = await c.query<{ tenant_id: string; id: string }>(
            `SELECT tenant_id, id FROM (
               SELECT tenant_id::text AS tenant_id, id::text AS id,
                      row_number() OVER (PARTITION BY tenant_id ORDER BY id::text) AS rn
                 FROM ${t} WHERE tenant_id::text = ANY($1)
             ) x WHERE rn <= $2`,
            [tenantIds, perTable],
          );
          await c.query('RELEASE SAVEPOINT fx');
        } catch {
          // A table the bootstrap role cannot sample is left out of the manifest.
          await c.query('ROLLBACK TO SAVEPOINT fx');
          continue;
        }
        if (r.rows.length === 0) continue;
        const entry: Partial<Record<TenantKey, string[]>> = {};
        for (const row of r.rows) {
          const k = byId.get(row.tenant_id);
          if (!k) continue;
          (entry[k] ??= []).push(row.id);
        }
        ids[table] = entry;
      }

      const guardians: FixtureManifest['principals']['guardians'] = {};
      const g = await c.query<{ tenant_id: string; parent_user_id: string }>(
        `SELECT DISTINCT tenant_id::text, parent_user_id FROM parent_child_links
          WHERE tenant_id::text = ANY($1) AND status = 'active' ORDER BY 1, 2`,
        [tenantIds],
      );
      for (const r of g.rows) {
        const k = byId.get(r.tenant_id);
        if (k) (guardians[k] ??= []).push(r.parent_user_id);
      }
      const students: FixtureManifest['principals']['students'] = {};
      const st = await c.query<{ tenant_id: string; id: string; sub: string }>(
        `SELECT tenant_id::text, id::text, custom_data->>'user_id' AS sub FROM students
          WHERE tenant_id::text = ANY($1) AND custom_data ? 'user_id' AND deleted_at IS NULL
          ORDER BY 1, 2`,
        [tenantIds],
      );
      for (const r of st.rows) {
        const k = byId.get(r.tenant_id);
        if (k && r.sub) (students[k] ??= []).push({ sub: r.sub, studentId: r.id });
      }
      return {
        generatedAt: new Date().toISOString(),
        gitSha: s.gitSha,
        tenants,
        ids,
        principals: { guardians, students },
      };
    } finally {
      await c.query('ROLLBACK');
    }
  });
}

export function writeFixtureManifest(file: string, m: FixtureManifest): void {
  writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
}

export function readFixtureManifest(file: string): FixtureManifest {
  return JSON.parse(readFileSync(file, 'utf8')) as FixtureManifest;
}

/** First sampled id of `table` for `tenant`, or undefined. */
export function fixtureId(
  m: FixtureManifest,
  table: string,
  tenant: TenantKey,
  index = 0,
): string | undefined {
  return m.ids[table]?.[tenant]?.[index];
}
