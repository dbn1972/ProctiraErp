/**
 * G-918 staff HR service: contracts, attendance, import, payroll, tenant isolate.
 */
import { randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { payableDays, StaffHrService, withRenewalAlert } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffService } from './staff-service.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

function services() {
  const staffRepo = new InMemoryStaffRepository();
  const staffService = new StaffService(staffRepo);
  const store = new InMemoryStaffHrStore();
  const hr = new StaffHrService(store, staffService);
  return { staffService, hr };
}

async function hire(
  staffService: StaffService,
  tenantId = TENANT_A,
  identity = `ID-${randomUUID().slice(0, 8)}`,
) {
  return staffService.create(tenantId, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '1988-12-10',
    identityNumber: identity,
    contactPhone: '+15550001',
    position: 'Teacher',
  });
}

describe('StaffHrService (G-918)', () => {
  it('creates a contract with a renewal alert inside 60 days and isolates tenants', async () => {
    const { staffService, hr } = services();
    const staff = await hire(staffService);
    const start = '2026-01-01';
    const end = '2026-10-01';
    const contract = await hr.createContract(TENANT_A, {
      staffId: staff.id,
      contractType: 'permanent',
      startDate: start,
      endDate: end,
      salaryBand: 'L4',
    });
    expect(contract.salaryBand).toBe('L4');
    const viewed = withRenewalAlert(contract, new Date('2026-09-09T00:00:00.000Z'));
    expect(viewed.renewalAlert).toBe(true);
    expect(viewed.daysUntilEnd).toBe(22);

    expect(await hr.listContracts(TENANT_B)).toHaveLength(0);
    await expect(hr.getContract(TENANT_B, contract.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects end before start', async () => {
    const { staffService, hr } = services();
    const staff = await hire(staffService);
    await expect(
      hr.createContract(TENANT_A, {
        staffId: staff.id,
        contractType: 'fixed_term',
        startDate: '2026-09-10',
        endDate: '2026-09-01',
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('records qualifications and verifies them', async () => {
    const { staffService, hr } = services();
    const staff = await hire(staffService);
    const qual = await hr.createQualification(TENANT_A, {
      staffId: staff.id,
      degree: 'M.Ed',
      institution: 'Delhi University',
      year: 2014,
    });
    expect(qual.verified).toBe(false);
    const verified = await hr.verifyQualification(TENANT_A, qual.id, {
      verified: true,
      documentRef: 'docs/qual-1',
    });
    expect(verified.verified).toBe(true);
    expect(verified.documentRef).toBe('docs/qual-1');
  });

  it('marks attendance, upserts the same day, and builds a monthly summary', async () => {
    const { staffService, hr } = services();
    const staff = await hire(staffService);
    await hr.markAttendance(
      TENANT_A,
      { staffId: staff.id, date: '2026-09-01', status: 'present' },
      'hr-1',
    );
    const updated = await hr.markAttendance(
      TENANT_A,
      { staffId: staff.id, date: '2026-09-01', status: 'half_day' },
      'hr-1',
    );
    expect(updated.status).toBe('half_day');
    await hr.markAttendance(
      TENANT_A,
      { staffId: staff.id, date: '2026-09-02', status: 'leave' },
      'hr-1',
    );
    const summary = await hr.attendanceSummary(TENANT_A, { month: '2026-09' });
    expect(summary[0]!.halfDay).toBe(1);
    expect(summary[0]!.leave).toBe(1);
    expect(summary[0]!.payableDays).toBe(payableDays(0, 1));
  });

  it('dry-runs CSV import then commits valid rows and exports payroll', async () => {
    const { hr } = services();
    const csv = `firstName,lastName,dateOfBirth,identityNumber,contactPhone,position,contactEmail,contractType,startDate,endDate,salaryBand
Grace,Hopper,1906-12-09,EMP-GH-1,+15551111,Teacher,grace@school.test,permanent,2026-04-01,2027-03-31,L5
,Bad,2010-01-01,EMP-BAD,+1,Teacher`;
    const dry = hr.dryRunImport({ csv });
    expect(dry.rows).toBe(2);
    expect(dry.valid).toBe(1);
    expect(dry.errors.some((e) => e.field === 'firstName')).toBe(true);

    const committed = await hr.commitImport(TENANT_A, { csv });
    expect(committed.created).toBe(1);
    expect(committed.staffIds).toHaveLength(1);

    const staffId = committed.staffIds[0]!;
    await hr.markAttendance(TENANT_A, { staffId, date: '2026-09-03', status: 'present' }, 'hr-1');
    const payroll = await hr.exportPayroll(TENANT_A, { month: '2026-09' });
    expect(payroll.filename).toBe('payroll-2026-09.csv');
    expect(payroll.csv).toMatch(/staffId,name,salaryBand/);
    const row = payroll.rows.find((r) => r.staffId === staffId);
    expect(row?.salaryBand).toBe('L5');
    expect(row?.daysPresent).toBe(1);
    expect(row?.deductionsCents).toBe(0);
    expect(row?.deductionsPlaceholder).toBe(0);
    expect(row?.grossCents).toBe(0);
    expect(row?.netCents).toBe(0);
    expect(row?.payableDays).toBe(1);
    expect(payroll.idempotent).toBe(false);
    expect(payroll.trialBalance.debitCents).toBe(payroll.trialBalance.creditCents);

    const again = await hr.exportPayroll(TENANT_A, { month: '2026-09' });
    expect(again.idempotent).toBe(true);
    expect(again.runId).toBe(payroll.runId);
  });

  it('W2-HR-01: computes unpaid absence deductions and balanced payroll posting', async () => {
    const { hr, staffService } = services();
    const created = await hire(staffService, TENANT_A, 'EMP-ADA-PAY');
    await hr.createContract(TENANT_A, {
      staffId: created.id,
      contractType: 'permanent',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      salaryBand: '30000.00',
      monthlyGrossCents: 3_000_000,
    });
    await hr.markAttendance(TENANT_A, { staffId: created.id, date: '2026-09-01', status: 'absent' }, 'hr-1');
    await hr.markAttendance(TENANT_A, { staffId: created.id, date: '2026-09-02', status: 'absent' }, 'hr-1');
    await hr.markAttendance(TENANT_A, { staffId: created.id, date: '2026-09-03', status: 'absent' }, 'hr-1');
    const payroll = await hr.exportPayroll(TENANT_A, { month: '2026-09' });
    const row = payroll.rows.find((r) => r.staffId === created.id);
    expect(row?.absentDays).toBe(3);
    expect(row?.grossCents).toBe(3_000_000);
    // 3000000 * 3 / 30 = 300000
    expect(row?.deductionsCents).toBe(300_000);
    expect(row?.netCents).toBe(2_700_000);
    expect(payroll.trialBalance.debitCents).toBe(payroll.trialBalance.creditCents);
    expect(payroll.trialBalance.accounts.salary_expense).toBe(3_000_000);
    expect(payroll.trialBalance.accounts.wages_payable).toBe(-2_700_000);
    expect(payroll.trialBalance.accounts.payroll_deductions).toBe(-300_000);
  });

  it('rejects empty import commit', async () => {
    const { hr } = services();
    await expect(
      hr.commitImport(TENANT_A, { csv: 'not,a,staff,header\n1,2,3,4' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
