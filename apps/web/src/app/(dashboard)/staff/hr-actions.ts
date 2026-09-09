'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  commitStaffImport,
  createStaffContract,
  createStaffQualification,
  dryRunStaffImport,
  exportStaffPayroll,
  markStaffAttendanceBulk,
  type CreateContractInput,
  type CreateQualificationInput,
  type PayrollExport,
  type StaffAttendanceStatus,
  type StaffImportReport,
} from '@/lib/api/staff';
import {
  contractFormSchema,
  qualificationFormSchema,
  staffImportSchema,
} from '@/lib/validation/staff-schema';

export interface HrActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
  report?: StaffImportReport;
  payroll?: PayrollExport;
}

export async function createContractAction(input: CreateContractInput): Promise<HrActionState> {
  const parsed = contractFormSchema.safeParse({
    ...input,
    endDate: input.endDate ?? '',
    salaryBand: input.salaryBand ?? '',
    notes: input.notes ?? '',
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid contract' };
  }
  try {
    const row = await createStaffContract({
      staffId: parsed.data.staffId,
      contractType: parsed.data.contractType,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate || undefined,
      salaryBand: parsed.data.salaryBand || undefined,
      notes: parsed.data.notes || undefined,
    });
    revalidatePath('/staff/contracts');
    revalidatePath('/staff/payroll');
    return { status: 'success', message: 'Contract recorded.', id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof GatewayError ? error.message : 'Failed to create contract',
    };
  }
}

export async function createQualificationAction(
  input: CreateQualificationInput,
): Promise<HrActionState> {
  const parsed = qualificationFormSchema.safeParse({
    ...input,
    documentRef: input.documentRef ?? '',
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid qualification' };
  }
  try {
    const row = await createStaffQualification({
      staffId: parsed.data.staffId,
      degree: parsed.data.degree,
      institution: parsed.data.institution,
      year: parsed.data.year,
      documentRef: parsed.data.documentRef || undefined,
    });
    revalidatePath('/staff/contracts');
    return { status: 'success', message: 'Qualification recorded.', id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof GatewayError ? error.message : 'Failed to create qualification',
    };
  }
}

export async function saveAttendanceAction(input: {
  date: string;
  marks: Array<{ staffId: string; status: StaffAttendanceStatus }>;
}): Promise<HrActionState> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.marks.length === 0) {
    return { status: 'error', message: 'Date and at least one mark are required.' };
  }
  try {
    await markStaffAttendanceBulk(input);
    revalidatePath('/staff/attendance');
    revalidatePath('/staff/payroll');
    return { status: 'success', message: `Saved ${input.marks.length} attendance mark(s).` };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof GatewayError ? error.message : 'Failed to save attendance',
    };
  }
}

export async function dryRunImportAction(csv: string, filename?: string): Promise<HrActionState> {
  const parsed = staffImportSchema.safeParse({ csv, filename });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid CSV' };
  }
  try {
    const report = await dryRunStaffImport(parsed.data.csv, parsed.data.filename);
    return {
      status: 'success',
      message: `${report.valid} valid of ${report.rows} row(s).`,
      report,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof GatewayError ? error.message : 'Dry-run failed',
    };
  }
}

export async function commitImportAction(csv: string, filename?: string): Promise<HrActionState> {
  const parsed = staffImportSchema.safeParse({ csv, filename });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid CSV' };
  }
  try {
    const report = await commitStaffImport(parsed.data.csv, parsed.data.filename);
    revalidatePath('/staff');
    revalidatePath('/staff/contracts');
    return {
      status: 'success',
      message: `Created ${report.created ?? 0} staff record(s).`,
      report,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof GatewayError ? error.message : 'Import commit failed',
    };
  }
}

export async function exportPayrollAction(month: string): Promise<HrActionState> {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { status: 'error', message: 'Month must be YYYY-MM' };
  }
  try {
    const payroll = await exportStaffPayroll(month);
    return { status: 'success', message: `Payroll for ${month}.`, payroll };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof GatewayError ? error.message : 'Payroll export failed',
    };
  }
}
