'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  applyConcession,
  applyScholarshipNetting,
  addReminderSuppression,
  bulkInvoiceStructure,
  createFeeStructure,
  generateInstalments,
  importReconciliation,
  recordInvoicePayment,
  refundInvoice,
  removeReminderSuppression,
  resolveReconciliationException,
  sendFeeReminders,
  type FeeReconciliationRow,
  type ScholarshipNettingResult,
  type SendRemindersResult,
} from '@/lib/api/fees';
import {
  bulkInvoiceFormSchema,
  concessionFormSchema,
  feeStructureFormSchema,
  reconciliationFormSchema,
  refundFormSchema,
  reminderSendFormSchema,
  reminderSuppressionFormSchema,
  resolveReconExceptionFormSchema,
  scholarshipNettingFormSchema,
  type BulkInvoiceFormValues,
  type ConcessionFormValues,
  type FeeStructureFormValues,
  type ReconciliationFormValues,
  type RefundFormValues,
  type ReminderSendFormValues,
  type ReminderSuppressionFormValues,
  type ResolveReconExceptionFormValues,
  type ScholarshipNettingFormValues,
} from './validation';

export interface FieldError {
  field: string;
  message: string;
}

export type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: FieldError[] };

function flattenZod(error: {
  flatten: () => { fieldErrors: Record<string, string[] | undefined> };
}): FieldError[] {
  return Object.entries(error.flatten().fieldErrors).flatMap(([field, messages]) =>
    (messages ?? []).map((message) => ({ field, message })),
  );
}

function fail(error: unknown): ActionResult<never> {
  if (error instanceof GatewayError) {
    return { success: false, error: error.message };
  }
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unexpected error',
  };
}

function refreshFees() {
  revalidatePath('/fees');
  revalidatePath('/fees/structures');
  revalidatePath('/fees/invoices');
  revalidatePath('/fees/reports');
  revalidatePath('/fees/reconciliation');
  revalidatePath('/fees/scholarship-netting');
  revalidatePath('/fees/dunning');
  revalidatePath('/parent/fees');
}

export async function createFeeStructureAction(
  values: FeeStructureFormValues,
): Promise<ActionResult<{ id: string }>> {
  const parsed = feeStructureFormSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: flattenZod(parsed.error) };
  }
  try {
    const structure = await createFeeStructure({
      name: parsed.data.name,
      code: parsed.data.code || undefined,
      category: parsed.data.category,
      term: parsed.data.term || undefined,
      amountCents: Math.round(parsed.data.amount * 100),
      classId: parsed.data.classId || undefined,
      gradeId: parsed.data.gradeId || undefined,
      currency: 'INR',
    });
    if (parsed.data.partCount && parsed.data.partCount > 1) {
      await generateInstalments(structure.id, parsed.data.partCount);
    }
    refreshFees();
    return { success: true, data: { id: structure.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function bulkInvoiceAction(
  values: BulkInvoiceFormValues,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const parsed = bulkInvoiceFormSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: flattenZod(parsed.error) };
  }
  const studentIds = (parsed.data.studentIds ?? '')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  try {
    const result = await bulkInvoiceStructure(parsed.data.structureId, {
      classId: parsed.data.classId || undefined,
      studentIds: studentIds.length > 0 ? studentIds : undefined,
      dueAt: parsed.data.dueAt || undefined,
    });
    refreshFees();
    return {
      success: true,
      data: { created: result.created.length, skipped: result.skipped.length },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function applyConcessionAction(
  values: ConcessionFormValues,
): Promise<ActionResult<{ discountCents: number }>> {
  const parsed = concessionFormSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: flattenZod(parsed.error) };
  }
  try {
    const result = await applyConcession({
      studentId: parsed.data.studentId,
      structureId: parsed.data.structureId,
      invoiceId: parsed.data.invoiceId || undefined,
      kind: parsed.data.kind,
      percent: parsed.data.kind === 'percent' ? parsed.data.percent : undefined,
      amountCents:
        parsed.data.kind === 'amount' && parsed.data.amount != null
          ? Math.round(parsed.data.amount * 100)
          : undefined,
      reason: parsed.data.reason,
    });
    refreshFees();
    return { success: true, data: { discountCents: result.discountCents } };
  } catch (error) {
    return fail(error);
  }
}

export async function refundInvoiceAction(
  values: RefundFormValues,
): Promise<ActionResult<{ id: string }>> {
  const parsed = refundFormSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: flattenZod(parsed.error) };
  }
  try {
    const refund = await refundInvoice(parsed.data.invoiceId, {
      amountCents: Math.round(parsed.data.amount * 100),
      reason: parsed.data.reason,
    });
    refreshFees();
    return { success: true, data: { id: refund.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function payInvoiceStaffAction(
  invoiceId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const invoice = await recordInvoicePayment(invoiceId);
    refreshFees();
    return { success: true, data: { id: invoice.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function importReconciliationAction(
  values: ReconciliationFormValues,
): Promise<ActionResult<{ matched: number; unmatched: number; batchId: string }>> {
  const parsed = reconciliationFormSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: flattenZod(parsed.error) };
  }
  try {
    const result = await importReconciliation(parsed.data.csv, parsed.data.filename);
    refreshFees();
    return {
      success: true,
      data: {
        matched: result.matched.length,
        unmatched: result.unmatched.length,
        batchId: result.batch.id,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function resolveReconExceptionAction(
  values: ResolveReconExceptionFormValues,
): Promise<ActionResult<FeeReconciliationRow>> {
  const parsed = resolveReconExceptionFormSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: flattenZod(parsed.error) };
  }
  try {
    const row = await resolveReconciliationException(parsed.data.rowId, {
      status: parsed.data.status,
      resolutionNote: parsed.data.resolutionNote,
    });
    refreshFees();
    return { success: true, data: row };
  } catch (error) {
    return fail(error);
  }
}

export async function applyScholarshipNettingAction(
  values: ScholarshipNettingFormValues,
): Promise<ActionResult<ScholarshipNettingResult>> {
  const parsed = scholarshipNettingFormSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: flattenZod(parsed.error) };
  }
  try {
    const result = await applyScholarshipNetting({
      studentId: parsed.data.studentId,
      disbursementId: parsed.data.disbursementId.trim(),
      amountCents: Math.round(parsed.data.amount * 100),
      invoiceId: parsed.data.invoiceId || undefined,
      currency: parsed.data.currency || undefined,
    });
    refreshFees();
    return { success: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

export async function sendFeeRemindersAction(
  values: ReminderSendFormValues,
): Promise<ActionResult<SendRemindersResult>> {
  const parsed = reminderSendFormSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: flattenZod(parsed.error) };
  }
  try {
    const result = await sendFeeReminders({
      invoiceIds: parsed.data.invoiceIds,
      channels: parsed.data.channels,
      minOverdueDays: parsed.data.minOverdueDays,
      cadenceDays: parsed.data.cadenceDays,
    });
    refreshFees();
    return { success: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

export async function addReminderSuppressionAction(
  values: ReminderSuppressionFormValues,
): Promise<ActionResult<{ id: string }>> {
  const parsed = reminderSuppressionFormSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed', fieldErrors: flattenZod(parsed.error) };
  }
  try {
    const row = await addReminderSuppression({
      studentId: parsed.data.studentId || undefined,
      invoiceId: parsed.data.invoiceId || undefined,
      reason: parsed.data.reason,
    });
    refreshFees();
    return { success: true, data: { id: row.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function removeReminderSuppressionAction(
  suppressionId: string,
): Promise<ActionResult<{ id: string }>> {
  if (!suppressionId?.trim()) {
    return { success: false, error: 'Suppression id is required' };
  }
  try {
    await removeReminderSuppression(suppressionId.trim());
    refreshFees();
    return { success: true, data: { id: suppressionId.trim() } };
  } catch (error) {
    return fail(error);
  }
}
