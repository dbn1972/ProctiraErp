/**
 * PRC-M557 (DR35) on a real Postgres: sign-off is stored as the staging schema
 * comment and the scheduled purge drops the schema (with its legacy PII rows)
 * only after sign-off + 30 days. Throwaway schema, dropped afterwards.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveDatabaseUrl } from './live-test-db.js';
import { enforceStagingRetention, recordCutoverSignOff } from './staging-retention.js';

const DATABASE_URL = liveDatabaseUrl('staging-retention.live.test');
const STAGING = `m557_staging_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
const SIGNED = new Date('2026-01-01T00:00:00.000Z');
const day = (n: number) => new Date(SIGNED.getTime() + n * 24 * 60 * 60 * 1000);

describe.skipIf(!DATABASE_URL)('PRC-M557 staging retention on live Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(`CREATE SCHEMA "${STAGING}"`);
    await pool.query(`CREATE TABLE "${STAGING}".legacy_people (id int, national_id text)`);
    await pool.query(`INSERT INTO "${STAGING}".legacy_people VALUES (1, 'AAD-1')`);
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS "${STAGING}" CASCADE`);
    await pool?.end();
  });

  const exists = async () =>
    (await pool.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [STAGING])).rowCount === 1;

  it('keeps the schema until sign-off + 30 days, then drops it', async () => {
    expect((await enforceStagingRetention(pool, STAGING, day(100))).action).toBe('retain');
    expect(await exists()).toBe(true);
    await recordCutoverSignOff(pool, STAGING, SIGNED);
    expect((await enforceStagingRetention(pool, STAGING, day(29))).action).toBe('retain');
    expect(await exists()).toBe(true);
    expect((await enforceStagingRetention(pool, STAGING, day(30))).action).toBe('purge');
    expect(await exists()).toBe(false);
    expect((await enforceStagingRetention(pool, STAGING, day(31))).action).toBe('absent');
  });
});
