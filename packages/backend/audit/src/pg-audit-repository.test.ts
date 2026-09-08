/**
 * Live smoke for PgAuditRepository against DATABASE_URL (skipped otherwise) — G-704.
 * Requires db/sql/022_control_plane_schema.sql applied.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import { PgAuditRepository } from './pg-audit-repository.js';

const pool = getSharedPgPool();

describe('PgAuditRepository (live)', () => {
  it.skipIf(!pool)('appends, queries, and refuses updates (append-only trigger)', async () => {
    const repo = new PgAuditRepository(pool!);
    const tenantId = randomUUID();
    const id = randomUUID();

    const created = await repo.create({
      id,
      tenantId,
      entityType: 'student',
      entityId: randomUUID(),
      operation: 'CREATE',
      userId: 'user-1',
      userName: 'Test User',
      ipAddress: '127.0.0.1',
      timestamp: new Date(),
      beforeValues: null,
      afterValues: { name: 'A' },
      metadata: { requestId: 'r1' },
    });
    expect(created.id).toBe(id);

    const found = await repo.findById(tenantId, id);
    expect(found?.afterValues).toEqual({ name: 'A' });

    const other = await repo.findById(randomUUID(), id);
    expect(other).toBeNull();

    const page = await repo.query({ tenantId, page: 1, pageSize: 10 });
    expect(page.meta.totalItems).toBe(1);

    const client = await pool!.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin','1',false)`);
      await expect(
        client.query(`UPDATE audit_log_entries SET user_name = 'x' WHERE id = $1`, [id]),
      ).rejects.toThrow(/append-only/i);
    } finally {
      client.release();
    }
  });

  it.skipIf(!pool)('stores retention config and archives expired rows', async () => {
    const repo = new PgAuditRepository(pool!);
    const tenantId = randomUUID();
    const old = new Date();
    old.setMonth(old.getMonth() - 24);

    await repo.create({
      id: randomUUID(),
      tenantId,
      entityType: 'staff',
      entityId: randomUUID(),
      operation: 'UPDATE',
      userId: 'u',
      userName: 'u',
      ipAddress: '::1',
      timestamp: old,
      beforeValues: { a: 1 },
      afterValues: { a: 2 },
    });

    await repo.setRetentionConfig({
      tenantId,
      retentionMonths: 12,
      archivalEnabled: true,
      archivalDestination: 's3://audit-archive',
      lastArchivalAt: null,
    });
    expect(await repo.getArchivalCandidateCount(tenantId)).toBe(1);

    const result = await repo.archiveExpiredEntries(tenantId);
    expect(result.archivedCount).toBe(1);
    expect((await repo.query({ tenantId, page: 1, pageSize: 10 })).meta.totalItems).toBe(0);

    const cfg = await repo.getRetentionConfig(tenantId);
    expect(cfg?.lastArchivalAt).toBeInstanceOf(Date);
  });
});
