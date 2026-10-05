/**
 * G-918 Staff / HR service: contracts, qualifications, attendance, CSV import, payroll export.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';

import type {
  AttendanceSummaryQuery,
  BulkAttendanceInput,
  CreateContractInput,
  CreateQualificationInput,
  MarkAttendanceInput,
  PayrollExportQuery,
  StaffImportInput,
  UpdateContractInput,
  VerifyQualificationInput,
} from './hr-schemas.js';
import type {
  AttendanceListFilter,
  PageWindow,
  StaffAttendanceRecord,
  StaffContractRecord,
  StaffContractStatus,
  StaffContractType,
  StaffHrStore,
  StaffQualificationRecord,
} from './hr-store.js';
import { readOffboardMeta } from './offboard-meta.js';
import {
  assertPayrollRowBalanced,
  calendarDaysInMonth,
  DEFAULT_PAYROLL_PRORATION,
  prorateMonthlyGrossCents,
  type PayrollProrationPolicy,
  resolveMonthlyGrossCents,
  unpaidAbsenceDeductionCents,
} from './payroll-compute.js';
import type { CreateStaffInput } from './schemas.js';
import { parseCsv, STAFF_IMPORT_REQUIRED_HEADERS, toCsv } from './staff-csv.js';
import type { StaffEntity } from './staff-repository.js';
import type { StaffService } from './staff-service.js';

export const CONTRACT_RENEWAL_WINDOW_DAYS = 60;

const CONTRACT_TYPES = new Set<StaffContractType>([
  'permanent',
  'probation',
  'fixed_term',
  'visiting',
  'intern',
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContractView extends StaffContractRecord {
  renewalAlert: boolean;
  daysUntilEnd: number | null;
}

export interface AttendanceSummaryRow {
  staffId: string;
  present: number;
  absent: number;
  leave: number;
  halfDay: number;
  payableDays: number;
}

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportDryRunResult {
  rows: number;
  valid: number;
  errors: ImportRowError[];
}

export interface ImportCommitResult extends ImportDryRunResult {
  created: number;
  staffIds: string[];
}

export interface PayrollRow {
  staffId: string;
  name: string;
  salaryBand: string;
  daysPresent: number;
  leaveDays: number;
  absentDays: number;
  /** Alias of deductionsCents for one-release compatibility. */
  deductionsPlaceholder: number;
  deductionsCents: number;
  grossCents: number;
  netCents: number;
  payableDays: number;
  /**
   * PRC-H089: present only when the staff member was offboarded inside the month and the
   * gross was pro-rated (`PAYROLL_PRORATION`). `fullMonthGrossCents` is the contract gross.
   */
  proration?: {
    policy: PayrollProrationPolicy;
    lastDay: string;
    eligibleDays: number;
    periodDays: number;
    fullMonthGrossCents: number;
  };
}

export interface StaffHrServiceOptions {
  /** PRC-H089: mid-month offboard pay policy (config `PAYROLL_PRORATION`). */
  payrollProration?: PayrollProrationPolicy;
}

export interface PayrollLedgerTrial {
  debitCents: number;
  creditCents: number;
  accounts: Record<'salary_expense' | 'payroll_deductions' | 'wages_payable', number>;
}

export interface PayrollExportResult {
  month: string;
  filename: string;
  csv: string;
  rows: PayrollRow[];
  runId: string;
  idempotent: boolean;
  trialBalance: PayrollLedgerTrial;
}

function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function daysUntil(endDate: string, now = new Date()): number {
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  const start = Date.parse(`${todayIso(now)}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000);
}

export function withRenewalAlert(record: StaffContractRecord, now = new Date()): ContractView {
  const days = record.endDate ? daysUntil(record.endDate, now) : null;
  const renewalAlert =
    record.status === 'active' && days != null && days >= 0 && days <= CONTRACT_RENEWAL_WINDOW_DAYS;
  return { ...record, renewalAlert, daysUntilEnd: days };
}

export function monthRange(month: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new ValidationError('month must be YYYY-MM');
  }
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const mon = Number(monthStr);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
  };
}

export function payableDays(present: number, halfDay: number): number {
  return present + halfDay * 0.5;
}

function assertDateOrder(start: string, end: string | null | undefined): void {
  if (end && end < start) {
    throw new BusinessRuleError('End date must be on or after start date');
  }
}

function buildContractRecord(tenantId: string, input: CreateContractInput): StaffContractRecord {
  assertDateOrder(input.startDate, input.endDate);
  const now = new Date();
  return {
    id: randomUUID(),
    tenantId,
    staffId: input.staffId,
    contractType: input.contractType,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    salaryBand: input.salaryBand ?? '',
    monthlyGrossCents:
      input.monthlyGrossCents != null
        ? input.monthlyGrossCents
        : resolveMonthlyGrossCents({ salaryBand: input.salaryBand ?? '' }),
    status: (input.status ?? 'active') as StaffContractStatus,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

interface ImportRowPlan {
  line: number;
  staff: CreateStaffInput;
  contract: Omit<CreateContractInput, 'staffId'> | null;
}

function importRowError(line: number, error: unknown): ImportRowError {
  const message = error instanceof Error ? error.message : 'Failed to create staff';
  // Prisma unique violations (P2002) / pg 23505 are not ConflictError; attribute them.
  const code = (error as { code?: unknown } | null)?.code;
  const isUniqueViolation = error instanceof ConflictError || code === 'P2002' || code === '23505';
  return isUniqueViolation
    ? { row: line, field: 'identityNumber', message }
    : { row: line, message };
}

export class StaffHrService {
  /** W2-HR-01: posted payroll runs keyed by tenant:month (idempotent re-export). */

  private readonly payrollProration: PayrollProrationPolicy;

  constructor(
    private readonly store: StaffHrStore,
    private readonly staffService: StaffService,
    options: StaffHrServiceOptions = {},
  ) {
    this.payrollProration = options.payrollProration ?? DEFAULT_PAYROLL_PRORATION;
  }

  async createContract(tenantId: string, input: CreateContractInput): Promise<ContractView> {
    await this.staffService.getById(tenantId, input.staffId);
    const record = await this.store.createContract(buildContractRecord(tenantId, input));
    return withRenewalAlert(record);
  }

  /** PRC-M379: windowed list with total. */
  async listContractsPage(tenantId: string, staffId: string | undefined, window: PageWindow) {
    const page = await this.store.listContractsPage(tenantId, staffId, window);
    return { rows: page.rows.map((row) => withRenewalAlert(row)), total: page.total };
  }

  async listQualificationsPage(tenantId: string, staffId: string | undefined, window: PageWindow) {
    return this.store.listQualificationsPage(tenantId, staffId, window);
  }

  async listAttendancePage(tenantId: string, filter: AttendanceListFilter, window: PageWindow) {
    return this.store.listAttendancePage(tenantId, filter, window);
  }

  async listContracts(tenantId: string, staffId?: string): Promise<ContractView[]> {
    const rows = await this.store.listContracts(tenantId, staffId);
    return rows.map((row) => withRenewalAlert(row));
  }

  async getContract(tenantId: string, id: string): Promise<ContractView> {
    const row = await this.store.findContract(tenantId, id);
    if (!row) throw new NotFoundError(`Contract with id '${id}' not found`);
    return withRenewalAlert(row);
  }

  async updateContract(
    tenantId: string,
    id: string,
    input: UpdateContractInput,
  ): Promise<ContractView> {
    const existing = await this.getContract(tenantId, id);
    const start = input.startDate ?? existing.startDate;
    const end = input.endDate === undefined ? existing.endDate : input.endDate;
    assertDateOrder(start, end);
    const updated = await this.store.updateContract(tenantId, id, input);
    if (!updated) throw new NotFoundError(`Contract with id '${id}' not found`);
    return withRenewalAlert(updated);
  }

  async createQualification(
    tenantId: string,
    input: CreateQualificationInput,
  ): Promise<StaffQualificationRecord> {
    await this.staffService.getById(tenantId, input.staffId);
    const now = new Date();
    return this.store.createQualification({
      id: randomUUID(),
      tenantId,
      staffId: input.staffId,
      degree: input.degree,
      institution: input.institution,
      year: input.year,
      verified: input.verified ?? false,
      documentRef: input.documentRef ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async listQualifications(
    tenantId: string,
    staffId?: string,
  ): Promise<StaffQualificationRecord[]> {
    return this.store.listQualifications(tenantId, staffId);
  }

  async verifyQualification(
    tenantId: string,
    id: string,
    input: VerifyQualificationInput,
  ): Promise<StaffQualificationRecord> {
    const updated = await this.store.updateQualification(tenantId, id, {
      verified: input.verified,
      documentRef: input.documentRef,
    });
    if (!updated) throw new NotFoundError(`Qualification with id '${id}' not found`);
    return updated;
  }

  async markAttendance(
    tenantId: string,
    input: MarkAttendanceInput,
    actorId: string | null,
  ): Promise<StaffAttendanceRecord> {
    await this.staffService.getById(tenantId, input.staffId);
    const now = new Date();
    return this.store.upsertAttendance({
      id: randomUUID(),
      tenantId,
      staffId: input.staffId,
      date: input.date,
      status: input.status,
      notes: input.notes ?? null,
      markedBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
  }

  async markAttendanceBulk(
    tenantId: string,
    input: BulkAttendanceInput,
    actorId: string | null,
  ): Promise<StaffAttendanceRecord[]> {
    // PRC-L153: one tenant-scoped existence query, then one atomic upsert for all marks.
    await this.staffService.assertStaffExist(
      tenantId,
      input.marks.map((m) => m.staffId),
    );
    const now = new Date();
    return this.store.upsertAttendanceBulk(
      input.marks.map((mark) => ({
        id: randomUUID(),
        tenantId,
        staffId: mark.staffId,
        date: input.date,
        status: mark.status,
        notes: mark.notes ?? null,
        markedBy: actorId,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  async listAttendance(
    tenantId: string,
    filter: { date?: string; staffId?: string; from?: string; to?: string },
  ): Promise<StaffAttendanceRecord[]> {
    return this.store.listAttendance(tenantId, filter);
  }

  async attendanceSummary(
    tenantId: string,
    query: AttendanceSummaryQuery,
  ): Promise<AttendanceSummaryRow[]> {
    const { from, to } = monthRange(query.month);
    const rows = await this.store.listAttendance(tenantId, {
      staffId: query.staffId,
      from,
      to,
    });
    const byStaff = new Map<string, AttendanceSummaryRow>();
    for (const row of rows) {
      const current = byStaff.get(row.staffId) ?? {
        staffId: row.staffId,
        present: 0,
        absent: 0,
        leave: 0,
        halfDay: 0,
        payableDays: 0,
      };
      if (row.status === 'present') current.present += 1;
      else if (row.status === 'absent') current.absent += 1;
      else if (row.status === 'leave') current.leave += 1;
      else if (row.status === 'half_day') current.halfDay += 1;
      current.payableDays = payableDays(current.present, current.halfDay);
      byStaff.set(row.staffId, current);
    }
    return [...byStaff.values()].sort((a, b) => a.staffId.localeCompare(b.staffId));
  }

  dryRunImport(input: StaffImportInput): ImportDryRunResult {
    const parsed = parseCsv(input.csv);
    if (parsed.error) {
      return { rows: 0, valid: 0, errors: [{ row: 1, message: parsed.error }] };
    }
    const headerSet = new Set(parsed.headers.map((h) => h.trim()));
    const errors: ImportRowError[] = [];
    for (const required of STAFF_IMPORT_REQUIRED_HEADERS) {
      if (!headerSet.has(required)) {
        errors.push({ row: 1, field: required, message: `Missing required column '${required}'` });
      }
    }
    if (errors.length > 0) {
      return { rows: parsed.rows.length, valid: 0, errors };
    }

    const seenIdentity = new Set<string>();
    for (const row of parsed.rows) {
      const v = row.values;
      const firstName = (v['firstName'] ?? '').trim();
      const lastName = (v['lastName'] ?? '').trim();
      const dateOfBirth = (v['dateOfBirth'] ?? '').trim();
      const identityNumber = (v['identityNumber'] ?? '').trim();
      const contactPhone = (v['contactPhone'] ?? '').trim();
      const position = (v['position'] ?? '').trim();
      const contactEmail = (v['contactEmail'] ?? '').trim();
      const contractType = (v['contractType'] ?? '').trim();
      const startDate = (v['startDate'] ?? '').trim();
      const endDate = (v['endDate'] ?? '').trim();

      if (!firstName) errors.push({ row: row.line, field: 'firstName', message: 'Required' });
      if (!lastName) errors.push({ row: row.line, field: 'lastName', message: 'Required' });
      if (!DATE_RE.test(dateOfBirth)) {
        errors.push({ row: row.line, field: 'dateOfBirth', message: 'Use YYYY-MM-DD' });
      }
      if (!identityNumber) {
        errors.push({ row: row.line, field: 'identityNumber', message: 'Required' });
      } else if (seenIdentity.has(identityNumber.toLowerCase())) {
        errors.push({
          row: row.line,
          field: 'identityNumber',
          message: 'Duplicate identity number in file',
        });
      } else {
        seenIdentity.add(identityNumber.toLowerCase());
      }
      if (!contactPhone) errors.push({ row: row.line, field: 'contactPhone', message: 'Required' });
      if (!position) errors.push({ row: row.line, field: 'position', message: 'Required' });
      if (contactEmail && !EMAIL_RE.test(contactEmail)) {
        errors.push({ row: row.line, field: 'contactEmail', message: 'Invalid email' });
      }
      if (contractType && !CONTRACT_TYPES.has(contractType as StaffContractType)) {
        errors.push({ row: row.line, field: 'contractType', message: 'Unknown contract type' });
      }
      if (startDate && !DATE_RE.test(startDate)) {
        errors.push({ row: row.line, field: 'startDate', message: 'Use YYYY-MM-DD' });
      }
      if (endDate && !DATE_RE.test(endDate)) {
        errors.push({ row: row.line, field: 'endDate', message: 'Use YYYY-MM-DD' });
      }
      if (startDate && endDate && endDate < startDate) {
        errors.push({ row: row.line, field: 'endDate', message: 'Must be on or after startDate' });
      }
    }

    const valid = parsed.rows.length - new Set(errors.map((e) => e.row)).size;
    return { rows: parsed.rows.length, valid: Math.max(0, valid), errors };
  }

  async commitImport(tenantId: string, input: StaffImportInput): Promise<ImportCommitResult> {
    const dry = this.dryRunImport(input);
    if (dry.errors.length > 0 && dry.valid === 0) {
      throw new ValidationError('Import has no valid rows', [
        { field: 'csv', rule: 'required', message: dry.errors[0]!.message },
      ]);
    }
    // PRC-L153 all-or-nothing option: refuse to write anything when any row is invalid.
    if (input.allOrNothing && dry.errors.length > 0) {
      throw new ValidationError(
        'Import rejected: allOrNothing is set and some rows are invalid',
        dry.errors.map((e) => ({
          field: `row${e.row}${e.field ? `.${e.field}` : ''}`,
          rule: 'invalid',
          message: e.message,
        })),
      );
    }
    const parsed = parseCsv(input.csv);
    const errorRows = new Set(dry.errors.map((e) => e.row));
    const plans: ImportRowPlan[] = [];
    for (const row of parsed.rows) {
      if (errorRows.has(row.line)) continue;
      const v = row.values;
      const contractType = (v['contractType'] ?? '').trim() as StaffContractType;
      const startDate = (v['startDate'] ?? '').trim();
      plans.push({
        line: row.line,
        staff: {
          firstName: (v['firstName'] ?? '').trim(),
          lastName: (v['lastName'] ?? '').trim(),
          dateOfBirth: (v['dateOfBirth'] ?? '').trim(),
          identityNumber: (v['identityNumber'] ?? '').trim(),
          contactPhone: (v['contactPhone'] ?? '').trim(),
          contactEmail: (v['contactEmail'] ?? '').trim() || undefined,
          position: (v['position'] ?? '').trim(),
        },
        contract:
          contractType && startDate
            ? {
                contractType,
                startDate,
                endDate: (v['endDate'] ?? '').trim() || undefined,
                salaryBand: (v['salaryBand'] ?? '').trim() || undefined,
              }
            : null,
      });
    }
    const { staffIds, errors: rowErrors } = await this.commitImportRows(
      tenantId,
      plans,
      Boolean(input.allOrNothing),
    );
    const commitErrors: ImportRowError[] = [...dry.errors, ...rowErrors];

    const result: ImportCommitResult = {
      rows: dry.rows,
      valid: dry.valid,
      errors: commitErrors,
      created: staffIds.length,
      staffIds,
    };
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        msg: 'staff.import.commit',
        tenantId,
        created: result.created,
        errors: result.errors.length,
      }),
    );
    return result;
  }

  /**
   * PRC-L153/L246: write staff + contract as one unit per row.
   * - Transactional stores (Prisma staff + pg contracts on the same database): each row is
   *   one DB transaction; with `allOrNothing` every row shares ONE transaction, so any
   *   failure rolls back the whole import.
   * - Otherwise: a contract failure purges the just-created staff row (compensation); with
   *   `allOrNothing` every row created so far is purged and the import is rejected.
   */
  private async commitImportRows(
    tenantId: string,
    plans: ImportRowPlan[],
    allOrNothing: boolean,
  ): Promise<{ staffIds: string[]; errors: ImportRowError[] }> {
    const createContractOn = this.store.createContractOn?.bind(this.store);
    if (createContractOn && this.staffService.supportsTransactions()) {
      const writeRow = async (
        scope: Parameters<Parameters<StaffService['withTransaction']>[1]>[0],
        plan: ImportRowPlan,
      ): Promise<string> => {
        const staff = await scope.createStaff(plan.staff);
        if (plan.contract) {
          await createContractOn(
            scope.executor,
            buildContractRecord(tenantId, { ...plan.contract, staffId: staff.id }),
          );
        }
        return staff.id;
      };
      if (allOrNothing) {
        let failing: ImportRowPlan | null = null;
        try {
          const ids = await this.staffService.withTransaction(tenantId, async (scope) => {
            const out: string[] = [];
            for (const plan of plans) {
              failing = plan;
              out.push(await writeRow(scope, plan));
            }
            failing = null;
            return out;
          });
          return { staffIds: ids, errors: [] };
        } catch (error) {
          throw this.allOrNothingRejected(failing, error);
        }
      }
      const staffIds: string[] = [];
      const errors: ImportRowError[] = [];
      for (const plan of plans) {
        try {
          staffIds.push(
            await this.staffService.withTransaction(tenantId, (scope) => writeRow(scope, plan)),
          );
        } catch (error) {
          errors.push(importRowError(plan.line, error));
        }
      }
      return { staffIds, errors };
    }

    const staffIds: string[] = [];
    const errors: ImportRowError[] = [];
    for (const plan of plans) {
      let createdId: string | null = null;
      try {
        const staff = await this.staffService.create(tenantId, plan.staff);
        createdId = staff.id;
        if (plan.contract) {
          await this.createContract(tenantId, { ...plan.contract, staffId: staff.id });
        }
        staffIds.push(staff.id);
      } catch (error) {
        const rowError = importRowError(plan.line, error);
        if (createdId) {
          try {
            await this.staffService.purgeCreated(tenantId, createdId);
          } catch {
            rowError.message = `${rowError.message}; staff ${createdId} was created without a contract and could not be rolled back`;
          }
        }
        if (allOrNothing) {
          for (const id of staffIds) {
            await this.staffService.purgeCreated(tenantId, id);
          }
          throw this.allOrNothingRejected(plan, error, rowError.message);
        }
        errors.push(rowError);
      }
    }
    return { staffIds, errors };
  }

  private allOrNothingRejected(
    plan: ImportRowPlan | null,
    error: unknown,
    message?: string,
  ): ValidationError {
    const rowError = plan
      ? importRowError(plan.line, error)
      : { row: 0, message: error instanceof Error ? error.message : 'Import failed' };
    return new ValidationError(
      'Import rejected: allOrNothing is set and a row failed; nothing was created',
      [
        {
          field: `row${rowError.row}${rowError.field ? `.${rowError.field}` : ''}`,
          rule: 'commit_failed',
          message: message ?? rowError.message,
        },
      ],
    );
  }

  /**
   * PRC-H089: every staff member of the tenant (keyset iteration when the repository
   * supports it; otherwise paged with a fetched-vs-totalItems guard). Excludes INACTIVE
   * staff and staff offboarded before the month starts; staff offboarded on/after the
   * month start remain in the run and are pro-rated by `PAYROLL_PRORATION`.
   */
  private async listPayrollEligibleStaff(
    tenantId: string,
    monthStart: string,
  ): Promise<StaffEntity[]> {
    const all = await this.staffService.listAll(tenantId);
    return all.filter((staff) => {
      const offboard = readOffboardMeta(staff.customData);
      if (offboard) return offboard.effectiveDate >= monthStart;
      return staff.status !== 'INACTIVE';
    });
  }

  async exportPayroll(tenantId: string, query: PayrollExportQuery): Promise<PayrollExportResult> {
    // PRC-M369: no process-local memo. The store is authoritative so a
    // reverse/replace on another replica is never masked by a stale run.
    if (!query.replace) {
      const stored = await this.store.findPayrollExport(tenantId, query.month);
      if (stored) {
        const result: PayrollExportResult = {
          month: stored.month,
          filename: stored.filename,
          csv: stored.csv,
          rows: JSON.parse(stored.rowsJson) as PayrollRow[],
          runId: stored.runId,
          idempotent: true,
          trialBalance: JSON.parse(stored.trialBalanceJson) as PayrollLedgerTrial,
        };
        return result;
      }
    }

    const { from, to } = monthRange(query.month);
    const daysInMonth = calendarDaysInMonth(query.month);
    const payrollStaff = await this.listPayrollEligibleStaff(tenantId, from);
    const contracts = await this.store.listContracts(tenantId);
    const attendance = await this.store.listAttendance(tenantId, { from, to });
    const summaries = new Map<string, AttendanceSummaryRow>();
    for (const row of attendance) {
      const current = summaries.get(row.staffId) ?? {
        staffId: row.staffId,
        present: 0,
        absent: 0,
        leave: 0,
        halfDay: 0,
        payableDays: 0,
      };
      if (row.status === 'present') current.present += 1;
      else if (row.status === 'leave') current.leave += 1;
      else if (row.status === 'half_day') current.halfDay += 1;
      else if (row.status === 'absent') current.absent += 1;
      current.payableDays = payableDays(current.present, current.halfDay);
      summaries.set(row.staffId, current);
    }

    const rows: PayrollRow[] = payrollStaff.map((staff) => {
      const summary = summaries.get(staff.id);
      const contract = pickContractForMonth(
        contracts.filter((c) => c.staffId === staff.id),
        from,
        to,
      );
      const absentDays = summary?.absent ?? 0;
      const fullMonthGrossCents = resolveMonthlyGrossCents({
        monthlyGrossCents: contract?.monthlyGrossCents,
        salaryBand: contract?.salaryBand,
      });
      const lastDay = readOffboardMeta(staff.customData)?.effectiveDate ?? null;
      const prorated = prorateMonthlyGrossCents({
        monthlyGrossCents: fullMonthGrossCents,
        policy: this.payrollProration,
        monthStart: from,
        monthEnd: to,
        lastDay,
      });
      const grossCents = prorated.grossCents;
      // Daily rate stays on the full-month gross; clamp so deductions never exceed pay.
      const deductionsCents = Math.min(
        grossCents,
        unpaidAbsenceDeductionCents(fullMonthGrossCents, absentDays, daysInMonth),
      );
      const netCents = grossCents - deductionsCents;
      const row: PayrollRow = {
        staffId: staff.id,
        name: `${staff.firstName} ${staff.lastName}`.trim(),
        salaryBand: contract?.salaryBand ?? '',
        daysPresent: summary?.present ?? 0,
        leaveDays: summary?.leave ?? 0,
        absentDays,
        deductionsPlaceholder: deductionsCents,
        deductionsCents,
        grossCents,
        netCents,
        payableDays: summary?.payableDays ?? 0,
      };
      if (lastDay && lastDay < to) {
        row.proration = {
          policy: prorated.policy,
          lastDay,
          eligibleDays: prorated.eligibleDays,
          periodDays: prorated.periodDays,
          fullMonthGrossCents,
        };
      }
      assertPayrollRowBalanced(row);
      return row;
    });

    const grossTotal = rows.reduce((s, r) => s + r.grossCents, 0);
    const deductionsTotal = rows.reduce((s, r) => s + r.deductionsCents, 0);
    const netTotal = rows.reduce((s, r) => s + r.netCents, 0);
    if (netTotal !== grossTotal - deductionsTotal) {
      throw new BusinessRuleError('Payroll run totals do not balance');
    }

    const trialBalance: PayrollLedgerTrial = {
      debitCents: grossTotal,
      creditCents: deductionsTotal + netTotal,
      accounts: {
        salary_expense: grossTotal,
        payroll_deductions: -deductionsTotal,
        wages_payable: -netTotal,
      },
    };
    if (trialBalance.debitCents !== trialBalance.creditCents) {
      throw new BusinessRuleError('Payroll ledger trial balance does not balance');
    }

    const csv = toCsv(
      [
        'staffId',
        'name',
        'salaryBand',
        'daysPresent',
        'leaveDays',
        'absentDays',
        'grossCents',
        'deductionsCents',
        'netCents',
        'payableDays',
      ],
      rows.map((row) => [
        row.staffId,
        row.name,
        row.salaryBand,
        row.daysPresent,
        row.leaveDays,
        row.absentDays,
        row.grossCents,
        row.deductionsCents,
        row.netCents,
        row.payableDays,
      ]),
    );

    const runId = randomUUID();
    const result: PayrollExportResult = {
      month: query.month,
      filename: `payroll-${query.month}.csv`,
      csv,
      rows,
      runId,
      idempotent: false,
      trialBalance,
    };
    const exportRecord = {
      tenantId,
      month: result.month,
      runId: result.runId,
      filename: result.filename,
      csv: result.csv,
      rowsJson: JSON.stringify(result.rows),
      trialBalanceJson: JSON.stringify(result.trialBalance),
      grossCents: result.rows.reduce((s, r) => s + r.grossCents, 0),
      deductionsCents: result.rows.reduce((s, r) => s + r.deductionsCents, 0),
      netCents: result.rows.reduce((s, r) => s + r.netCents, 0),
      createdAt: new Date(),
    };
    if (query.replace) {
      await this.store.reverseAndReplacePayrollExport(exportRecord);
    } else {
      await this.store.savePayrollExport(exportRecord);
    }

    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        msg: 'staff.payroll.export',
        tenantId,
        month: query.month,
        rows: rows.length,
        runId,
        grossCents: grossTotal,
        deductionsCents: deductionsTotal,
        netCents: netTotal,
        replace: Boolean(query.replace),
      }),
    );

    return result;
  }
}

function pickContractForMonth(
  contracts: StaffContractRecord[],
  from: string,
  to: string,
): StaffContractRecord | undefined {
  const overlapping = contracts.filter((c) => {
    if (c.status === 'terminated') return false;
    if (c.startDate > to) return false;
    if (c.endDate && c.endDate < from) return false;
    return true;
  });
  overlapping.sort((a, b) => b.startDate.localeCompare(a.startDate));
  return overlapping[0];
}
