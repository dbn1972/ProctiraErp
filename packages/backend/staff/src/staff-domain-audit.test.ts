/**
 * PRC-M544 (failing-first, audit): staff/HR mutations — payroll run post/replace, contract
 * create/update, salary change, leave decision, offboarding and qualification verification —
 * each emit one domain audit entry through the injected `auditSink`, carrying tenantId,
 * actorId, entityType, entityId and action. Audit only: payroll figures are unchanged.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffLeaveService } from './leave-service.js';
import type { StaffAuditEntry } from './staff-audit.js';
import { StaffService } from './staff-service.js';

const TENANT = randomUUID();
const HR_ACTOR = 'hr-admin-1';

function harness() {
  const entries: StaffAuditEntry[] = [];
  const auditSink = async (entry: StaffAuditEntry) => {
    entries.push(entry);
  };
  const staffService = new StaffService(new InMemoryStaffRepository(), { auditSink });
  const hr = new StaffHrService(new InMemoryStaffHrStore(), staffService, { auditSink });
  const leaveRepo = new InMemoryStaffLeaveRepository();
  const leave = new StaffLeaveService(leaveRepo, undefined, { auditSink });
  return { entries, staffService, hr, leave, leaveRepo };
}

function only(entries: StaffAuditEntry[], action: string): StaffAuditEntry {
  const matching = entries.filter((e) => e.action === action);
  expect(matching, `audit entries for ${action}`).toHaveLength(1);
  const entry = matching[0]!;
  expect(entry.tenantId).toBe(TENANT);
  expect(entry.actorId).toBe(HR_ACTOR);
  expect(entry.entityType).toBeTruthy();
  expect(entry.entityId).toBeTruthy();
  return entry;
}

async function hire(staffService: StaffService) {
  return staffService.create(TENANT, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '1988-12-10',
    identityNumber: `ID-${randomUUID().slice(0, 8)}`,
    contactPhone: '+15550001',
    position: 'Teacher',
  });
}

describe('PRC-M544 staff/HR domain audit', () => {
  it('audits contract create, a non-salary update and a salary change', async () => {
    const { entries, staffService, hr } = harness();
    const staff = await hire(staffService);
    const contract = await hr.createContract(
      TENANT,
      {
        staffId: staff.id,
        contractType: 'permanent',
        startDate: '2026-01-01',
        salaryBand: 'L4',
        monthlyGrossCents: 5_000_000,
      },
      HR_ACTOR,
    );
    expect(only(entries, 'contract.create').entityId).toBe(contract.id);
    await hr.updateContract(TENANT, contract.id, { notes: 'renewal due' }, HR_ACTOR);
    expect(only(entries, 'contract.update').entityId).toBe(contract.id);
    await hr.updateContract(TENANT, contract.id, { monthlyGrossCents: 5_500_000 }, HR_ACTOR);
    const salary = only(entries, 'contract.salary_change');
    expect(salary.before).toMatchObject({ monthlyGrossCents: 5_000_000, salaryBand: 'L4' });
    expect(salary.after).toMatchObject({ monthlyGrossCents: 5_500_000, salaryBand: 'L4' });
  });

  it('audits qualification verification', async () => {
    const { entries, staffService, hr } = harness();
    const staff = await hire(staffService);
    const q = await hr.createQualification(TENANT, {
      staffId: staff.id,
      degree: 'B.Ed',
      institution: 'Uni',
      year: 2010,
    });
    await hr.verifyQualification(TENANT, q.id, { verified: true }, HR_ACTOR);
    const entry = only(entries, 'qualification.verify');
    expect(entry.entityId).toBe(q.id);
    expect(entry.before).toMatchObject({ verified: false });
    expect(entry.after).toMatchObject({ verified: true });
  });

  it('audits a payroll run once when posted, not on an idempotent re-read, and on replace', async () => {
    const { entries, staffService, hr } = harness();
    await hire(staffService);
    const run = await hr.exportPayroll(TENANT, { month: '2026-09' }, HR_ACTOR);
    await hr.exportPayroll(TENANT, { month: '2026-09' }, HR_ACTOR);
    const posted = only(entries, 'payroll.post');
    expect(posted.entityId).toBe(run.runId);
    expect(posted.after).toMatchObject({ month: '2026-09', rows: run.rows.length });
    const replaced = await hr.exportPayroll(TENANT, { month: '2026-09', replace: true }, HR_ACTOR);
    const replace = only(entries, 'payroll.replace');
    expect(replace.entityId).toBe(replaced.runId);
  });

  it('audits a leave decision', async () => {
    const { entries, leave, leaveRepo } = harness();
    const staffId = randomUUID();
    await leaveRepo.setBalance(TENANT, staffId, 'sick', 10);
    const row = await leave.createLeave(TENANT, {
      staffId,
      leaveType: 'sick',
      startDate: '2026-09-10',
      endDate: '2026-09-11',
    });
    await leave.decideLeave(TENANT, row.id, { status: 'approved' }, HR_ACTOR);
    const entry = only(entries, 'leave.decide');
    expect(entry.entityId).toBe(row.id);
    expect(entry.before).toMatchObject({ status: 'pending' });
    expect(entry.after).toMatchObject({ status: 'approved' });
  });

  it('audits offboarding', async () => {
    const { entries, staffService } = harness();
    const staff = await hire(staffService);
    await staffService.offboard(
      TENANT,
      staff.id,
      { effectiveDate: '2026-09-30', reason: 'End of term' },
      HR_ACTOR,
    );
    const entry = only(entries, 'staff.offboard');
    expect(entry.entityId).toBe(staff.id);
    expect(entry.after).toMatchObject({ status: 'INACTIVE', effectiveDate: '2026-09-30' });
  });

  it('payroll figures are identical with and without a sink', async () => {
    const plain = new StaffService(new InMemoryStaffRepository());
    const plainHr = new StaffHrService(new InMemoryStaffHrStore(), plain);
    const audited = harness();
    for (const svc of [plain, audited.staffService]) await hire(svc);
    const a = await plainHr.exportPayroll(TENANT, { month: '2026-09' });
    const b = await audited.hr.exportPayroll(TENANT, { month: '2026-09' }, HR_ACTOR);
    expect(b.rows.map((r) => [r.grossCents, r.deductionsCents, r.netCents])).toEqual(
      a.rows.map((r) => [r.grossCents, r.deductionsCents, r.netCents]),
    );
    expect(b.trialBalance).toEqual(a.trialBalance);
  });
});
