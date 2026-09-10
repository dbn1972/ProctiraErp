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

describe('PgAuditRepository hash chain (live, G-913)', () => {
  it.skipIf(!pool)('chains inserts, verifies, and flags out-of-band tampering', async () => {
    const repo = new PgAuditRepository(pool!);
    const tenantId = randomUUID();
    const base = {
      tenantId,
      entityType: 'student',
      operation: 'UPDATE' as const,
      userId: 'user-1',
      userName: 'Test User',
      ipAddress: '127.0.0.1',
      beforeValues: { name: 'A' },
      afterValues: { name: 'B' },
      metadata: null,
    };
    const first = await repo.create({
      ...base,
      id: randomUUID(),
      entityId: randomUUID(),
      timestamp: new Date(),
    });
    const second = await repo.create({
      ...base,
      id: randomUUID(),
      entityId: randomUUID(),
      timestamp: new Date(),
    });
    expect(first.chainSeq).toBe(1);
    expect(second.chainSeq).toBe(2);
    expect(second.prevHash).toBe(first.entryHash);

    const clean = await repo.verifyChain(tenantId);
    expect(clean.valid).toBe(true);
    expect(clean.checkedEntries).toBe(2);
    expect(clean.headHash).toBe(second.entryHash);

    // Simulate a DBA bypassing the append-only trigger.
    const client = await pool!.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin','1',false)`);
      await client.query(`ALTER TABLE audit_log_entries DISABLE TRIGGER trg_audit_log_append_only`);
      await client.query(
        `UPDATE audit_log_entries SET after_values = '{"name":"forged"}'::jsonb WHERE id = $1`,
        [first.id],
      );
    } finally {
      await client.query(`ALTER TABLE audit_log_entries ENABLE TRIGGER trg_audit_log_append_only`);
      client.release();
    }

    const tampered = await repo.verifyChain(tenantId);
    expect(tampered.valid).toBe(false);
    expect(tampered.brokenAt?.chainSeq).toBe(1);
    expect(tampered.brokenAt?.reason).toBe('hash-mismatch');
  });

  it.skipIf(!pool)('lists archival-enabled tenants for the retention sweep', async () => {
    const repo = new PgAuditRepository(pool!);
    const tenantId = randomUUID();
    await repo.setRetentionConfig({
      tenantId,
      retentionMonths: 6,
      archivalEnabled: true,
      archivalDestination: null,
      lastArchivalAt: null,
    });
    expect(await repo.listTenantsWithArchivalEnabled()).toContain(tenantId);
  });
});
