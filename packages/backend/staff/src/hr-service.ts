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
  StaffAttendanceRecord,
  StaffContractRecord,
  StaffContractStatus,
  StaffContractType,
  StaffHrStore,
  StaffQualificationRecord,
} from './hr-store.js';
import {
  parseCsv,
  STAFF_IMPORT_REQUIRED_HEADERS,
  toCsv,
} from './staff-csv.js';
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
  deductionsPlaceholder: number;
  payableDays: number;
}

export interface PayrollExportResult {
  month: string;
  filename: string;
  csv: string;
  rows: PayrollRow[];
}

function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function daysUntil(endDate: string, now = new Date()): number {
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  const start = Date.parse(`${todayIso(now)}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000);
}

export function withRenewalAlert(
  record: StaffContractRecord,
  now = new Date(),
): ContractView {
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

export class StaffHrService {
  constructor(
    private readonly store: StaffHrStore,
    private readonly staffService: StaffService,
  ) {}

  async createContract(tenantId: string, input: CreateContractInput): Promise<ContractView> {
    await this.staffService.getById(tenantId, input.staffId);
    assertDateOrder(input.startDate, input.endDate);
    const now = new Date();
    const record = await this.store.createContract({
      id: randomUUID(),
      tenantId,
      staffId: input.staffId,
      contractType: input.contractType,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      salaryBand: input.salaryBand ?? '',
      status: (input.status ?? 'active') as StaffContractStatus,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return withRenewalAlert(record);
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
    const out: StaffAttendanceRecord[] = [];
    for (const mark of input.marks) {
      out.push(
        await this.markAttendance(
          tenantId,
          { staffId: mark.staffId, date: input.date, status: mark.status, notes: mark.notes },
          actorId,
        ),
      );
    }
    return out;
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
    const parsed = parseCsv(input.csv);
    const errorRows = new Set(dry.errors.map((e) => e.row));
    const staffIds: string[] = [];
    const commitErrors: ImportRowError[] = [...dry.errors];

    for (const row of parsed.rows) {
      if (errorRows.has(row.line)) continue;
      const v = row.values;
      try {
        const staff = await this.staffService.create(tenantId, {
          firstName: (v['firstName'] ?? '').trim(),
          lastName: (v['lastName'] ?? '').trim(),
          dateOfBirth: (v['dateOfBirth'] ?? '').trim(),
          identityNumber: (v['identityNumber'] ?? '').trim(),
          contactPhone: (v['contactPhone'] ?? '').trim(),
          contactEmail: (v['contactEmail'] ?? '').trim() || undefined,
          position: (v['position'] ?? '').trim(),
        });
        staffIds.push(staff.id);
        const contractType = (v['contractType'] ?? '').trim() as StaffContractType;
        const startDate = (v['startDate'] ?? '').trim();
        if (contractType && startDate) {
          await this.createContract(tenantId, {
            staffId: staff.id,
            contractType,
            startDate,
            endDate: (v['endDate'] ?? '').trim() || undefined,
            salaryBand: (v['salaryBand'] ?? '').trim() || undefined,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create staff';
        if (error instanceof ConflictError) {
          commitErrors.push({ row: row.line, field: 'identityNumber', message });
        } else {
          commitErrors.push({ row: row.line, message });
        }
      }
    }

    const result: ImportCommitResult = {
      rows: dry.rows,
      valid: dry.valid,
      errors: commitErrors,
      created: staffIds.length,
      staffIds,
    };
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

  async exportPayroll(tenantId: string, query: PayrollExportQuery): Promise<PayrollExportResult> {
    const { from, to } = monthRange(query.month);
    const staffPage = await this.staffService.list(tenantId, {}, { page: 1, pageSize: 500 });
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

    const rows: PayrollRow[] = staffPage.data.map((staff) => {
      const summary = summaries.get(staff.id);
      const contract = pickContractForMonth(
        contracts.filter((c) => c.staffId === staff.id),
        from,
        to,
      );
      return {
        staffId: staff.id,
        name: `${staff.firstName} ${staff.lastName}`.trim(),
        salaryBand: contract?.salaryBand ?? '',
        daysPresent: summary?.present ?? 0,
        leaveDays: summary?.leave ?? 0,
        deductionsPlaceholder: 0,
        payableDays: summary?.payableDays ?? 0,
      };
    });

    const csv = toCsv(
      [
        'staffId',
        'name',
        'salaryBand',
        'daysPresent',
        'leaveDays',
        'deductionsPlaceholder',
        'payableDays',
      ],
      rows.map((row) => [
        row.staffId,
        row.name,
        row.salaryBand,
        row.daysPresent,
        row.leaveDays,
        row.deductionsPlaceholder,
        row.payableDays,
      ]),
    );

    console.info(
      JSON.stringify({
        msg: 'staff.payroll.export',
        tenantId,
        month: query.month,
        rows: rows.length,
      }),
    );

    return {
      month: query.month,
      filename: `payroll-${query.month}.csv`,
      csv,
      rows,
    };
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
