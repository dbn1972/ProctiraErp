/**
 * G-913 — tamper-evident hash chain + runtime retention sweep.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson, computeEntryHash, verifyEntrySequence } from './audit-hash.js';
import type { AuditLogEntry, CreateAuditLogInput } from './audit-repository.js';
import { AuditService } from './audit-service.js';
import { InMemoryAuditRepository } from './in-memory-repository.js';
import { createRetentionScheduler } from './retention-scheduler.js';

const TENANT = '00000000-0000-4000-8000-000000000001';

function input(overrides: Partial<CreateAuditLogInput> = {}): CreateAuditLogInput {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    entityType: 'student',
    entityId: randomUUID(),
    operation: 'UPDATE',
    userId: 'user-1',
    userName: 'Admin',
    ipAddress: '10.0.0.1',
    timestamp: new Date('2026-09-01T10:00:00.000Z'),
    beforeValues: { name: 'A' },
    afterValues: { name: 'B' },
    metadata: { requestId: 'r1' },
    ...overrides,
  };
}

describe('canonicalJson / computeEntryHash', () => {
  it('is key-order independent and covers prevHash', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,2]},"b":1}',
    );
    const base = input();
    const h1 = computeEntryHash(base, null);
    const h2 = computeEntryHash(
      { ...base, afterValues: { name: 'B' }, beforeValues: { name: 'A' } },
      null,
    );
    expect(h1).toBe(h2);
    expect(computeEntryHash(base, 'abc')).not.toBe(h1);
    expect(computeEntryHash({ ...base, afterValues: { name: 'C' } }, null)).not.toBe(h1);
  });
});

describe('InMemoryAuditRepository chain', () => {
  it('links entries per tenant and verifies clean', async () => {
    const repo = new InMemoryAuditRepository();
    const a = await repo.create(input());
    const b = await repo.create(input());
    const other = await repo.create(input({ tenantId: 'tenant-b' }));

    expect(a.chainSeq).toBe(1);
    expect(a.prevHash).toBeNull();
    expect(b.chainSeq).toBe(2);
    expect(b.prevHash).toBe(a.entryHash);
    expect(other.chainSeq).toBe(1);

    const v = await repo.verifyChain(TENANT);
    expect(v.valid).toBe(true);
    expect(v.checkedEntries).toBe(2);
    expect(v.headHash).toBe(b.entryHash);
    expect(v.headSeq).toBe(2);
  });

  it('detects a tampered payload at the exact position', async () => {
    const repo = new InMemoryAuditRepository();
    await repo.create(input());
    const victim = await repo.create(input());
    await repo.create(input());

    repo.tamperForTest(victim.id, { afterValues: { name: 'forged' } });

    const v = await repo.verifyChain(TENANT);
    expect(v.valid).toBe(false);
    expect(v.brokenAt?.chainSeq).toBe(2);
    expect(v.brokenAt?.entryId).toBe(victim.id);
    expect(v.brokenAt?.reason).toBe('hash-mismatch');
    expect(v.checkedEntries).toBe(1);
  });

  it('detects a deleted (missing) link as a sequence gap', () => {
    const repo = new InMemoryAuditRepository();
    const entries: AuditLogEntry[] = [];
    const seed = async () => {
      for (let i = 0; i < 3; i += 1) entries.push(await repo.create(input()));
    };
    return seed().then(() => {
      const without = entries.filter((e) => e.chainSeq !== 2);
      const v = verifyEntrySequence(TENANT, without);
      expect(v.valid).toBe(false);
      expect(v.brokenAt?.reason).toBe('sequence-gap');
      expect(v.brokenAt?.chainSeq).toBe(3);
    });
  });

  it('reports legacy (unhashed) rows without failing', () => {
    const legacy: AuditLogEntry = {
      ...input(),
      metadata: null,
      chainSeq: null,
      prevHash: null,
      entryHash: null,
    };
    const v = verifyEntrySequence(TENANT, [legacy]);
    expect(v.valid).toBe(true);
    expect(v.legacyEntries).toBe(1);
    expect(v.checkedEntries).toBe(0);
  });

  it('archival keeps the chain verifiable across active + archive', async () => {
    const repo = new InMemoryAuditRepository();
    const old = new Date();
    old.setMonth(old.getMonth() - 30);
    await repo.create(input({ timestamp: old }));
    await repo.create(input({ timestamp: old }));
    await repo.create(input());
    await repo.setRetentionConfig({
      tenantId: TENANT,
      retentionMonths: 12,
      archivalEnabled: true,
      archivalDestination: 's3://bucket/audit',
      lastArchivalAt: null,
    });
    const result = await repo.archiveExpiredEntries(TENANT);
    expect(result.archivedCount).toBe(2);
    const v = await repo.verifyChain(TENANT);
    expect(v.valid).toBe(true);
    expect(v.checkedEntries).toBe(3);
  });
});

describe('AuditService.runRetentionSweep + scheduler', () => {
  it('archives for every archival-enabled tenant and isolates failures', async () => {
    const repo = new InMemoryAuditRepository();
    const service = new AuditService(repo);
    const old = new Date();
    old.setMonth(old.getMonth() - 30);
    await repo.create(input({ timestamp: old }));
    await repo.create(input({ tenantId: 'tenant-b', timestamp: old }));
    await repo.create(input({ tenantId: 'tenant-c', timestamp: old }));
    for (const tenantId of [TENANT, 'tenant-b']) {
      await repo.setRetentionConfig({
        tenantId,
        retentionMonths: 12,
        archivalEnabled: true,
        archivalDestination: null,
        lastArchivalAt: null,
      });
    }
    await repo.setRetentionConfig({
      tenantId: 'tenant-c',
      retentionMonths: 12,
      archivalEnabled: false,
      archivalDestination: null,
      lastArchivalAt: null,
    });

    const origArchive = repo.archiveExpiredEntries.bind(repo);
    repo.archiveExpiredEntries = async (tenantId: string) => {
      if (tenantId === 'tenant-b') throw new Error('boom');
      return origArchive(tenantId);
    };

    const scheduler = createRetentionScheduler({ service, intervalMs: 1000, initialDelayMs: 0 });
    const result = await scheduler.runOnce();
    expect(result.tenants).toBe(2);
    expect(result.archived).toBe(1);
    expect(result.failures).toEqual([{ tenantId: 'tenant-b', error: 'boom' }]);
    expect(scheduler.lastRun?.failures).toBe(1);

    // tenant-c (archival disabled) untouched
    const c = await repo.query({ tenantId: 'tenant-c', page: 1, pageSize: 10 });
    expect(c.meta.totalItems).toBe(1);

    scheduler.start();
    expect(scheduler.running).toBe(true);
    scheduler.stop();
    expect(scheduler.running).toBe(false);
  });
});
