/**
 * PRC-M553 / PRC-M419 — generate-uuids against a real Postgres.
 *
 * Base behaviour this pins against: phase 2 joined the UUID map on a `_legacy_id`
 * column it had just added but never populated, so no primary key was converted and the
 * run still reported success; foreign keys pointed at the old integers. A failed
 * statement aborted the transaction and COMMIT was still issued.
 *
 * Runs in throwaway schemas (dropped afterwards) as the migration role
 * (MIGRATOR_DATABASE_URL, falling back to DATABASE_URL). Fails closed when CI=true or
 * REQUIRE_LIVE_TESTS=1 and no database URL is set (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateUuids } from './generate-uuids.js';
import type { MigrationConfig, TableMapping } from './types.js';
import { liveDatabaseUrl } from './live-test-db.js';

const DATABASE_URL = liveDatabaseUrl('generate-uuids.live.test');
const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
const STAGING = `m553_staging_${suffix}`;
const TARGET = `m553_target_${suffix}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const mappings: TableMapping[] = [
  {
    sourceTable: 'legacy_parents',
    targetTable: 'parents',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [],
    foreignKeys: [],
  },
  {
    sourceTable: 'legacy_children',
    targetTable: 'children',
    legacyPkColumn: 'id',
    requiresUuidGeneration: true,
    columns: [],
    foreignKeys: [
      {
        column: 'parent_id',
        referencesTable: 'legacy_parents',
        referencesColumn: 'id',
        targetReferencesTable: 'parents',
      },
      {
        column: 'guardian_ref',
        referencesTable: 'legacy_parents',
        referencesColumn: 'id',
        targetReferencesTable: 'parents',
      },
    ],
  },
];

const config = {
  stagingSchema: STAGING,
  batchSize: 2,
  pg: { schema: TARGET },
} as unknown as MigrationConfig;

describe.skipIf(!DATABASE_URL)('PRC-M553 generate-uuids on live Postgres', () => {
  let admin: Pool;
  let pool: Pool;

  async function seed(children: Array<[string, string | null]>) {
    await admin.query(`DROP SCHEMA IF EXISTS "${STAGING}" CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS "${TARGET}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${STAGING}"`);
    await admin.query(`CREATE SCHEMA "${TARGET}"`);
    await admin.query(`
      CREATE TABLE "${STAGING}".legacy_parents (id integer PRIMARY KEY, name text);
      CREATE TABLE "${STAGING}".legacy_children (id integer PRIMARY KEY, parent_id integer);
      INSERT INTO "${STAGING}".legacy_parents VALUES (1, 'A'), (2, 'B'), (3, 'C');
      -- As left by transform-schema: legacy integers copied into text keys.
      CREATE TABLE "${TARGET}".parents (id text PRIMARY KEY, name text);
      CREATE TABLE "${TARGET}".children (
        id varchar(36) PRIMARY KEY, parent_id text, guardian_ref uuid
      );
      INSERT INTO "${TARGET}".parents VALUES ('1', 'A'), ('2', 'B'), ('3', 'C');
    `);
    for (const [id, parent] of children) {
      await admin.query(`INSERT INTO "${STAGING}".legacy_children VALUES ($1::int, $2::int)`, [
        id,
        parent,
      ]);
      await admin.query(`INSERT INTO "${TARGET}".children (id, parent_id) VALUES ($1, $2)`, [
        id,
        parent,
      ]);
    }
  }

  beforeAll(() => {
    admin = new Pool({ connectionString: DATABASE_URL, max: 2 });
    // migration_uuid_map is created unqualified: keep it inside the throwaway schema.
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 2,
      options: `-c search_path="${TARGET}"`,
    });
  });

  afterAll(async () => {
    await admin?.query(`DROP SCHEMA IF EXISTS "${STAGING}" CASCADE`);
    await admin?.query(`DROP SCHEMA IF EXISTS "${TARGET}" CASCADE`);
    await pool?.end();
    await admin?.end();
  });

  it('converts PKs to the mapped UUIDs, keeps _legacy_id and remaps FKs', async () => {
    await seed([
      ['10', '1'],
      ['11', '2'],
      ['12', null],
    ]);
    const result = await generateUuids(config, { pool, mappings });
    expect(result.errors).toEqual([]);
    expect(result.status).toBe('success');
    expect(result.rowsProcessed).toBe(6);

    const map = new Map(
      (
        await admin.query<{ legacy_table: string; legacy_id: string; new_uuid: string }>(
          `SELECT legacy_table, legacy_id::text, new_uuid::text FROM "${TARGET}".migration_uuid_map`,
        )
      ).rows.map((r) => [`${r.legacy_table}:${r.legacy_id}`, r.new_uuid]),
    );
    expect(map.size).toBe(6);

    const parents = (
      await admin.query<{ id: string; legacy: string }>(
        `SELECT id, _legacy_id::text AS legacy FROM "${TARGET}".parents ORDER BY _legacy_id`,
      )
    ).rows;
    expect(parents.map((p) => p.legacy)).toEqual(['1', '2', '3']);
    for (const p of parents) {
      expect(p.id).toMatch(UUID_RE);
      expect(p.id).toBe(map.get(`legacy_parents:${p.legacy}`));
    }

    const children = (
      await admin.query<{ id: string; legacy: string; parent_id: string | null }>(
        `SELECT id, _legacy_id::text AS legacy, parent_id FROM "${TARGET}".children ORDER BY _legacy_id`,
      )
    ).rows;
    expect(children.map((c) => c.legacy)).toEqual(['10', '11', '12']);
    expect(children[0]!.id).toBe(map.get('legacy_children:10'));
    expect(children[0]!.parent_id).toBe(map.get('legacy_parents:1'));
    expect(children[1]!.parent_id).toBe(map.get('legacy_parents:2'));
    expect(children[2]!.parent_id).toBeNull();
  });

  it('is idempotent: a second run changes nothing', async () => {
    const before = (await admin.query(`SELECT id, parent_id FROM "${TARGET}".children ORDER BY id`))
      .rows;
    const again = await generateUuids(config, { pool, mappings });
    expect(again.errors).toEqual([]);
    expect(again.status).toBe('success');
    const after = (await admin.query(`SELECT id, parent_id FROM "${TARGET}".children ORDER BY id`))
      .rows;
    expect(after).toEqual(before);
  });

  it('rolls the whole run back when a foreign key has no mapping', async () => {
    // child 21 points at legacy parent 99, which does not exist.
    await seed([
      ['20', '1'],
      ['21', '99'],
    ]);
    const result = await generateUuids(config, { pool, mappings });
    expect(result.status).toBe('error');
    expect(JSON.stringify(result.errors)).toMatch(/parent_id.*no legacy_parents mapping/);

    // Nothing from the failed run was committed: keys are still the legacy integers
    // and the mapping table does not exist.
    const parents = (await admin.query(`SELECT id FROM "${TARGET}".parents ORDER BY id`)).rows;
    expect(parents.map((p) => p.id)).toEqual(['1', '2', '3']);
    const children = (
      await admin.query(`SELECT id, parent_id FROM "${TARGET}".children ORDER BY id`)
    ).rows;
    expect(children).toEqual([
      { id: '20', parent_id: '1' },
      { id: '21', parent_id: '99' },
    ]);
    const mapTable = await admin.query(`SELECT to_regclass($1) AS t`, [
      `"${TARGET}".migration_uuid_map`,
    ]);
    expect(mapTable.rows[0].t).toBeNull();
  });
});
