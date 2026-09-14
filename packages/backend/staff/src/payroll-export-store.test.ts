import { afterEach, describe, expect, it } from 'vitest';

import { createStaffHrStore } from './create-staff-hr-store.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffService } from './staff-service.js';

describe('W1-DATA-07 payroll export durability', () => {
  it('round-trips payroll export through the HR store', async () => {
    const store = new InMemoryStaffHrStore();
    const saved = await store.savePayrollExport({
      tenantId: 't1',
      month: '2025-09',
      runId: 'run-1',
      filename: 'payroll-2025-09.csv',
      csv: 'staffId,netCents\ns1,100\n',
      rowsJson: '[{"staffId":"s1","netCents":100}]',
      trialBalanceJson: '{"debitCents":100,"creditCents":100,"accounts":{}}',
      grossCents: 120,
      deductionsCents: 20,
      netCents: 100,
      createdAt: new Date('2025-09-14T00:00:00.000Z'),
    });
    expect(saved.runId).toBe('run-1');
    const loaded = await store.findPayrollExport('t1', '2025-09');
    expect(loaded?.csv).toContain('s1,100');
    expect(loaded?.grossCents).toBe(120);
  });

  it('exportPayroll is durable across StaffHrService instances sharing a store', async () => {
    const store = new InMemoryStaffHrStore();
    const staffService = new StaffService(new InMemoryStaffRepository());
    const first = new StaffHrService(store, staffService);
    const second = new StaffHrService(store, staffService);

    const tenantId = '00000000-0000-4000-8000-000000000001';
    const export1 = await first.exportPayroll(tenantId, { month: '2026-09' });
    expect(export1.idempotent).toBe(false);

    const export2 = await second.exportPayroll(tenantId, { month: '2026-09' });
    expect(export2.idempotent).toBe(true);
    expect(export2.runId).toBe(export1.runId);
  });
});

describe('W1-DATA-07 staff HR store selection', () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevRequire = process.env.REQUIRE_DATABASE;

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevRequire === undefined) delete process.env.REQUIRE_DATABASE;
    else process.env.REQUIRE_DATABASE = prevRequire;
  });

  it('uses in-memory when DATABASE_URL is unset (non-production)', () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'test';
    delete process.env.REQUIRE_DATABASE;
    const store = createStaffHrStore();
    expect(store).toBeInstanceOf(InMemoryStaffHrStore);
  });
});
