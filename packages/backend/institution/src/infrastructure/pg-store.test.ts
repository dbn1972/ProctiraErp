/**
 * G-901 / G-812-style Postgres smoke for the infrastructure stores
 * (db/sql/027). Skips cleanly when DATABASE_URL is unset; with a DB it proves
 * create → read within tenant → cross-tenant RLS deny via the request-scoped
 * tenant context.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { tenantContext } from '../tenant-context.js';
import { ensureInfrastructureSchema, PgInfrastructureStore } from './pg-store.js';
import type { InfrastructureRecord } from './service.js';

const DATABASE_URL = process.env['DATABASE_URL']?.trim();

function record(institutionId: string, name: string): InfrastructureRecord {
  const now = new Date();
  return {
    id: randomUUID(),
    institutionId,
    parentId: null,
    type: 'LAND',
    name,
    capacity: 100,
    condition: 'GOOD',
    description: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe.skipIf(!DATABASE_URL)('PgInfrastructureStore (live Postgres)', () => {
  const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;

  afterAll(async () => {
    await pool?.end();
  });

  it('persists within the tenant and hides rows from another tenant (RLS)', async () => {
    const store = new PgInfrastructureStore(pool!);
    await ensureInfrastructureSchema(pool!);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const institutionId = randomUUID();

    const created = await tenantContext.run({ tenantId: tenantA }, () =>
      store.create(record(institutionId, 'Campus A')),
    );
    expect(created.name).toBe('Campus A');

    const seenByA = await tenantContext.run({ tenantId: tenantA }, () =>
      store.findAllByInstitution(institutionId),
    );
    expect(seenByA.map((r) => r.id)).toContain(created.id);

    const seenByB = await tenantContext.run({ tenantId: tenantB }, () =>
      store.findAllByInstitution(institutionId),
    );
    expect(seenByB).toEqual([]);

    const byIdB = await tenantContext.run({ tenantId: tenantB }, () => store.findById(created.id));
    expect(byIdB).toBeNull();

    const updated = await tenantContext.run({ tenantId: tenantA }, () =>
      store.update(created.id, { capacity: 250 }),
    );
    expect(updated?.capacity).toBe(250);

    const deleted = await tenantContext.run({ tenantId: tenantA }, () => store.delete(created.id));
    expect(deleted).toBe(true);
  });

  it('rejects access without a tenant context', async () => {
    const store = new PgInfrastructureStore(pool!);
    await expect(store.findById(randomUUID())).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
  });
});

describe('PgInfrastructureStore (no DATABASE_URL)', () => {
  it.skipIf(!!DATABASE_URL)('is skipped without a database', () => {
    expect(DATABASE_URL).toBeUndefined();
  });
});
