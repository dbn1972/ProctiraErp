/**
 * PRC-L002 — live Postgres proof of the admissions tenant-timezone path.
 *
 * The offer → enrolment transaction reads the tenant zone on its tenant-bound (RLS) connection:
 * admin tenant settings first, then `tenants.config` locale. A tenant in Asia/Kolkata accepting an
 * offer at 2026-12-31T19:00Z (00:30 IST on 1 January) must get enrolledAt 2027-01-01 and an
 * ADM-2027-* number; another tenant's settings are invisible under RLS.
 *
 * Skips when DATABASE_URL is unset; the CI live gate provides it.
 */
import { randomUUID } from 'node:crypto';
import { getSharedPgPool, withPgTenant, withPlatformScope } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatAdmissionNumber,
  loadAdmissionsTimeZone,
  tenantLocalDate,
} from './admissions-offer-policy.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeLive = DATABASE_URL ? describe : describe.skip;
const SETTINGS_TENANT = randomUUID();
const CONFIG_TENANT = randomUUID();
const ACCEPTED_AT = new Date('2026-12-31T19:00:00Z');

describeLive('PRC-L002 admissions tenant timezone (live Postgres)', () => {
  beforeAll(async () => {
    const pool = getSharedPgPool();
    if (!pool) throw new Error('shared pg pool unavailable');
    await ensurePgTestTenant(pool, SETTINGS_TENANT);
    await ensurePgTestTenant(pool, CONFIG_TENANT);
    await withPlatformScope(pool, async (client) => {
      // The settings tenant's config says UTC; its admin settings (higher priority) say IST.
      await client.query(
        `UPDATE tenants SET config = '{"locale":{"timezone":"UTC"}}'::jsonb WHERE id = $1::uuid`,
        [SETTINGS_TENANT],
      );
      await client.query(
        `UPDATE tenants SET config = '{"locale":{"timezone":"America/New_York"}}'::jsonb
          WHERE id = $1::uuid`,
        [CONFIG_TENANT],
      );
    });
    await withPgTenant(pool, SETTINGS_TENANT, async (client) => {
      await client.query(
        `INSERT INTO control_plane_documents (collection, id, tenant_id, data)
         VALUES ('tenant.settings', $1, $1, $2::jsonb)
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`,
        [SETTINGS_TENANT, JSON.stringify({ tenantId: SETTINGS_TENANT, timezone: 'Asia/Kolkata' })],
      );
    });
  });

  afterAll(async () => {
    const pool = getSharedPgPool();
    if (!pool) return;
    await withPgTenant(pool, SETTINGS_TENANT, (client) =>
      client.query(
        `DELETE FROM control_plane_documents WHERE collection = 'tenant.settings' AND id = $1`,
        [SETTINGS_TENANT],
      ),
    );
  });

  it('admin settings win and drive the enrolment date and admission-number year', async () => {
    const pool = getSharedPgPool()!;
    const zone = await withPgTenant(pool, SETTINGS_TENANT, (client) =>
      loadAdmissionsTimeZone(client, SETTINGS_TENANT),
    );
    expect(zone).toBe('Asia/Kolkata');
    expect(tenantLocalDate(ACCEPTED_AT, zone)).toBe('2027-01-01');
    expect(formatAdmissionNumber(ACCEPTED_AT, zone, 7)).toBe('ADM-2027-0007');
  });

  it("falls back to tenants.config locale and never reads another tenant's settings", async () => {
    const pool = getSharedPgPool()!;
    const zone = await withPgTenant(pool, CONFIG_TENANT, (client) =>
      loadAdmissionsTimeZone(client, CONFIG_TENANT),
    );
    expect(zone).toBe('America/New_York');
    expect(tenantLocalDate(ACCEPTED_AT, zone)).toBe('2026-12-31');
    // Bound to CONFIG_TENANT, SETTINGS_TENANT's settings document is filtered by RLS.
    const crossTenant = await withPgTenant(pool, CONFIG_TENANT, (client) =>
      client.query(
        `SELECT 1 FROM control_plane_documents WHERE collection = 'tenant.settings' AND id = $1`,
        [SETTINGS_TENANT],
      ),
    );
    expect(crossTenant.rows).toHaveLength(0);
  });
});
