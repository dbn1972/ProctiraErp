/**
 * PRC-L153 / PRC-L246 — staff CSV import writes staff + contract in ONE transaction per row
 * when the stores share a database, and `allOrNothing` is true all-or-nothing at commit time
 * (runtime failures roll back every row, not just dry-run validation errors).
 */
import { randomUUID } from 'node:crypto';
import { ValidationError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore, type StaffContractRecord } from './hr-store.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import type { StaffEntity, StaffTransactionScope } from './staff-repository.js';
import { StaffService } from './staff-service.js';

const TENANT = randomUUID();
const HEADER =
  'firstName,lastName,dateOfBirth,identityNumber,contactPhone,position,contactEmail,contractType,startDate,endDate,salaryBand';
const row = (n: number) =>
  `First${n},Last${n},1980-01-01,EMP-${n},+1555000${n},Teacher,,permanent,2026-04-01,,L5`;

/**
 * Transaction-capable fake: staff rows and executor SQL are buffered per transaction and
 * only become visible on commit; a throw discards both (models one Postgres transaction).
 */
class TxStaffRepository extends InMemoryStaffRepository {
  transactions = 0;
  async withTransaction<T>(
    tenantId: string,
    fn: (scope: StaffTransactionScope) => Promise<T>,
  ): Promise<T> {
    this.transactions += 1;
    const pendingStaff: Omit<StaffEntity, 'createdAt' | 'updatedAt'>[] = [];
    const pendingSql: { text: string; values: unknown[] }[] = [];
    const result = await fn({
      create: async (data) => {
        pendingStaff.push(data);
        const now = new Date();
        return { ...data, createdAt: now, updatedAt: now };
      },
      executor: {
        query: async (text, values = []) => {
          pendingSql.push({ text, values });
          return { rows: [] };
        },
      },
    });
    for (const s of pendingStaff) await this.create({ ...s, tenantId });
    committedSql.push(...pendingSql);
    return result;
  }
}
const committedSql: { text: string; values: unknown[] }[] = [];

class TxHrStore extends InMemoryStaffHrStore {
  failForIdentity: string | null = null;
  byStaffIdentity = new Map<string, string>();
  async createContractOn(
    executor: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> },
    record: StaffContractRecord,
  ): Promise<StaffContractRecord> {
    await executor.query('INSERT INTO staff_contracts', [record.id, record.staffId]);
    if (this.failForIdentity && this.byStaffIdentity.get(record.staffId) === this.failForIdentity) {
      throw new Error('contract insert failed');
    }
    return record;
  }
}

function txServices() {
  committedSql.length = 0;
  const repo = new TxStaffRepository();
  const staffService = new StaffService(repo);
  const store = new TxHrStore();
  // Map staff id -> identity number so the store can fail a chosen row.
  const origCreate = staffService.withTransaction.bind(staffService);
  vi.spyOn(staffService, 'withTransaction').mockImplementation((tenantId, fn) =>
    origCreate(tenantId, (scope) =>
      fn({
        ...scope,
        createStaff: async (input) => {
          const s = await scope.createStaff(input);
          store.byStaffIdentity.set(s.id, input.identityNumber);
          return s;
        },
      }),
    ),
  );
  const hr = new StaffHrService(store, staffService);
  return { repo, staffService, store, hr };
}

async function count(staffService: StaffService) {
  return (await staffService.list(TENANT, {}, { page: 1, pageSize: 100 })).meta.totalItems;
}

describe('PRC-L153/L246 staff import — transactional stores', () => {
  it('one transaction per row; a contract failure leaves no staff row for that line', async () => {
    const { repo, staffService, store, hr } = txServices();
    store.failForIdentity = 'EMP-2';
    const res = await hr.commitImport(TENANT, { csv: [HEADER, row(1), row(2), row(3)].join('\n') });
    expect(repo.transactions).toBe(3);
    expect(res.created).toBe(2);
    expect(res.errors).toEqual([expect.objectContaining({ row: 3 })]);
    expect(await count(staffService)).toBe(2);
    expect(committedSql).toHaveLength(2);
  });

  it('allOrNothing: a runtime contract failure rolls back every row (one transaction)', async () => {
    const { repo, staffService, store, hr } = txServices();
    store.failForIdentity = 'EMP-3';
    await expect(
      hr.commitImport(TENANT, {
        csv: [HEADER, row(1), row(2), row(3)].join('\n'),
        allOrNothing: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.transactions).toBe(1);
    expect(await count(staffService)).toBe(0);
    expect(committedSql).toHaveLength(0);
  });

  it('allOrNothing success commits all rows in one transaction', async () => {
    const { repo, staffService, hr } = txServices();
    const res = await hr.commitImport(TENANT, {
      csv: [HEADER, row(1), row(2)].join('\n'),
      allOrNothing: true,
    });
    expect(res.created).toBe(2);
    expect(repo.transactions).toBe(1);
    expect(await count(staffService)).toBe(2);
  });
});

describe('PRC-L153 staff import — non-transactional fallback', () => {
  it('allOrNothing: a runtime failure purges rows already created and rejects', async () => {
    const staffService = new StaffService(new InMemoryStaffRepository());
    const store = new InMemoryStaffHrStore();
    const hr = new StaffHrService(store, staffService);
    const real = store.createContract.bind(store);
    let calls = 0;
    vi.spyOn(store, 'createContract').mockImplementation(async (rec) => {
      calls += 1;
      if (calls === 2) throw new Error('contract store down');
      return real(rec);
    });
    await expect(
      hr.commitImport(TENANT, { csv: [HEADER, row(1), row(2)].join('\n'), allOrNothing: true }),
    ).rejects.toThrow(/nothing was created/);
    expect(await count(staffService)).toBe(0);
  });
});
