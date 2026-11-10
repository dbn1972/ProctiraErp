/**
 * PRC-L590 — the student in-package audit must write to the durable, chained
 * audit store, not an isolated ephemeral store.
 *
 * Failing-first: on base, the student audit module ships only
 * {@link InMemoryAuditStore}, whose entries carry no tamper-evident chain
 * (`entryHash`/`prevHash`/`chainSeq`) and whose data is lost on process exit.
 * `DurableAuditStore` does not exist, so this file does not compile/import on
 * base — the test run exits non-zero. After the fix the student `AuditService`
 * can be constructed over the durable chained store through an injected port,
 * and every recorded entry carries chain integrity that the durable store
 * verifies.
 *
 * Requirements: 21.1, 21.3 (append-only + tamper-evident durable store).
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { AuditService } from './audit-service.js';
import type { AuditContext } from './audit-service.js';
import { DurableAuditStore } from './durable-audit-store.js';
import type { DurableAuditAppend, DurableAuditRecord } from './durable-audit-store.js';

const TENANT_ID = '00000000-0000-4000-8000-0000000000aa';
const USER_ID = 'user-001';
const IP_ADDRESS = '192.168.1.100';

function createContext(overrides: Partial<AuditContext> = {}): AuditContext {
  return { userId: USER_ID, tenantId: TENANT_ID, ipAddress: IP_ADDRESS, ...overrides };
}

/**
 * A minimal durable chained store stand-in that reproduces the durable store's
 * contract: append-only, per-tenant hash chain (chainSeq starts at 1, each
 * entry's prevHash links to the previous entryHash). This mirrors the
 * @proctira/backend-audit InMemoryAuditRepository chain without importing it
 * (the student package takes no new dependency; the durable store is injected).
 */
function createChainedAppend(): {
  append: DurableAuditAppend;
  records: () => DurableAuditRecord[];
  tamper: (index: number, mutate: (r: DurableAuditRecord) => void) => void;
  verify: () => { valid: boolean; brokenAtSeq: number | null };
} {
  const byTenant = new Map<string, DurableAuditRecord[]>();
  let counter = 0;

  const append: DurableAuditAppend = async (input) => {
    const chain = byTenant.get(input.tenantId) ?? [];
    const head = chain[chain.length - 1];
    const chainSeq = (head?.chainSeq ?? 0) + 1;
    const prevHash = head?.entryHash ?? null;
    counter += 1;
    // Deterministic, linked hash: depends on the canonical input AND prevHash.
    const entryHash = `h:${input.tenantId}:${chainSeq}:${input.entityId}:${input.operation}:${prevHash ?? 'genesis'}:${counter}`;
    const record: DurableAuditRecord = {
      id: `${input.tenantId}:${chainSeq}`,
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      userId: input.userId,
      ipAddress: input.ipAddress,
      changes: input.changes,
      timestamp: input.timestamp,
      chainSeq,
      prevHash,
      entryHash,
    };
    chain.push(record);
    byTenant.set(input.tenantId, chain);
    return record;
  };

  const records = () => byTenant.get(TENANT_ID) ?? [];

  const tamper = (index: number, mutate: (r: DurableAuditRecord) => void) => {
    const chain = byTenant.get(TENANT_ID) ?? [];
    const row = chain[index];
    if (row) mutate(row);
  };

  const verify = () => {
    const chain = byTenant.get(TENANT_ID) ?? [];
    let prev: string | null = null;
    for (const row of chain) {
      if (row.prevHash !== prev) return { valid: false, brokenAtSeq: row.chainSeq };
      const expected = `h:${row.tenantId}:${row.chainSeq}:${row.entityId}:${row.operation}:${row.prevHash ?? 'genesis'}:`;
      if (!row.entryHash.startsWith(expected)) return { valid: false, brokenAtSeq: row.chainSeq };
      prev = row.entryHash;
    }
    return { valid: true, brokenAtSeq: null };
  };

  return { append, records, tamper, verify };
}

describe('DurableAuditStore (PRC-L590)', () => {
  let chained: ReturnType<typeof createChainedAppend>;
  let store: DurableAuditStore;
  let service: AuditService;

  beforeEach(() => {
    chained = createChainedAppend();
    store = new DurableAuditStore({ append: chained.append });
    service = new AuditService(store);
  });

  it('writes student audit entries to the durable store with chain integrity', async () => {
    const entry = await service.recordCreate(createContext(), 'student', 'student-001', {
      id: 'student-001',
      name: 'John Doe',
    });

    // The returned entry carries durable-chain fields (not available from the
    // in-memory store, whose AuditEntry had none of these).
    expect(entry.chainSeq).toBe(1);
    expect(entry.prevHash).toBeNull();
    expect(entry.entryHash).toBeTruthy();

    // The entry actually landed in the durable store.
    const persisted = chained.records();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.entityId).toBe('student-001');
  });

  it('links successive entries into a verifiable per-tenant chain', async () => {
    await service.recordCreate(createContext(), 'student', 's1', { id: 's1', name: 'A' });
    const second = await service.recordUpdate(
      createContext(),
      'student',
      's1',
      { id: 's1', name: 'A' },
      { id: 's1', name: 'B' },
    );

    expect(second).not.toBeNull();
    expect(second!.chainSeq).toBe(2);
    expect(second!.prevHash).toBe(chained.records()[0]!.entryHash);
    expect(chained.verify()).toEqual({ valid: true, brokenAtSeq: null });
  });

  it('makes tampering with a persisted entry detectable (tamper-evident)', async () => {
    await service.recordCreate(createContext(), 'student', 's1', { id: 's1', name: 'A' });
    await service.recordUpdate(
      createContext(),
      'student',
      's1',
      { id: 's1', name: 'A' },
      { id: 's1', name: 'B' },
    );

    expect(chained.verify().valid).toBe(true);

    // Forge the first entry's recorded entity; the chain no longer verifies.
    chained.tamper(0, (r) => {
      r.entityId = 'forged';
    });

    const result = chained.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
  });

  it('propagates the recording context (tenant, user, ip) to the durable record', async () => {
    await service.recordDelete(createContext({ userId: 'admin-9' }), 'student', 's9', {
      id: 's9',
      name: 'Z',
    });
    const [row] = chained.records();
    expect(row!.tenantId).toBe(TENANT_ID);
    expect(row!.userId).toBe('admin-9');
    expect(row!.ipAddress).toBe(IP_ADDRESS);
    expect(row!.operation).toBe('delete');
  });
});
