import { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Upper bound for a single fee amount in major units (₹10 crore). */
export const MAX_FEE_AMOUNT = 100_000_000;

/**
 * PRC-L025: form inputs arrive as strings; `z.coerce.number()` turns '' into 0
 * and silently accepts it. Empty/whitespace becomes `undefined` so a missing
 * amount is reported instead of being saved as zero.
 */
function toNumberOrUndefined(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : Number(trimmed);
  }
  return value;
}

function positiveAmount(label: string) {
  return z.preprocess(
    toNumberOrUndefined,
    z
      .number({ message: `${label} is required` })
      .gt(0, `${label} must be greater than 0`)
      .max(MAX_FEE_AMOUNT, `${label} is too large`),
  );
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Splits the free-text student id list the same way `bulkInvoiceAction` does. */
export function parseStudentIdList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

export const feeStructureFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(500),
  code: z.string().max(64).optional().or(z.literal('')),
  category: z.string().min(1, 'Category is required').max(120),
  term: z.string().max(64).optional().or(z.literal('')),
  amount: positiveAmount('Amount'),
  classId: z.string().regex(UUID, 'Class must be a UUID').optional().or(z.literal('')),
  gradeId: z.string().regex(UUID, 'Grade must be a UUID').optional().or(z.literal('')),
  partCount: z.coerce.number().int().min(1).max(24).optional(),
});

export const bulkInvoiceFormSchema = z.object({
  structureId: z.string().regex(UUID, 'Structure is required'),
  classId: z.string().regex(UUID).optional().or(z.literal('')),
  studentIds: z
    .string()
    .optional()
    .refine((raw) => parseStudentIdList(raw).every((id) => UUID.test(id)), {
      message: 'Each student ID must be a UUID',
    }),
  dueAt: z
    .string()
    .optional()
    .refine((raw) => !raw || isValidIsoDate(raw), { message: 'Due date must be YYYY-MM-DD' }),
});

export const concessionFormSchema = z
  .object({
    studentId: z.string().regex(UUID, 'Student must be a UUID'),
    structureId: z.string().regex(UUID, 'Structure must be a UUID'),
    invoiceId: z.string().regex(UUID).optional().or(z.literal('')),
    kind: z.enum(['percent', 'amount']),
    percent: z.preprocess(
      toNumberOrUndefined,
      z.number().min(0).max(100, 'Percent must be at most 100').optional(),
    ),
    amount: z.preprocess(toNumberOrUndefined, z.number().min(0).max(MAX_FEE_AMOUNT).optional()),
    reason: z.string().trim().min(1, 'Reason is required').max(2000),
    // PRC-H058: replay-safe concession apply.
    idempotencyKey: z.string().regex(UUID).optional(),
  })
  // PRC-L025 / PRC-L238: the value matching the chosen kind is required and
  // non-zero, so a blank/0 value never silently applies a 0% (or 0) concession.
  .superRefine((value, ctx) => {
    if (value.kind === 'percent' && !(value.percent != null && value.percent > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['percent'],
        message: 'Enter a percent greater than 0 and at most 100',
      });
    }
    if (value.kind === 'amount' && !(value.amount != null && value.amount > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'Enter an amount greater than 0',
      });
    }
  });

export const refundFormSchema = z.object({
  invoiceId: z.string().regex(UUID, 'Invoice is required'),
  amount: z.coerce.number().gt(0, 'Amount must be greater than 0'),
  reason: z.string().min(1, 'Reason is required').max(2000),
  // PRC-H058: one key per confirmed submission so a retried/double-submitted refund posts once.
  idempotencyKey: z.string().regex(UUID).optional(),
});

export const reconciliationFormSchema = z.object({
  csv: z.string().min(1, 'CSV is required'),
  filename: z.string().max(255).optional(),
});

export const resolveReconExceptionFormSchema = z.object({
  rowId: z.string().regex(UUID, 'Row is required'),
  status: z.enum(['resolved', 'ignored']),
  resolutionNote: z.string().min(1, 'Resolution note is required').max(2000),
});

/**
 * Staff F1 — POST /fees/scholarships/net body. PRC-H020: no operator-typed amount; the
 * gateway credits the verified paid disbursement amount.
 */
export const scholarshipNettingFormSchema = z.object({
  studentId: z.string().regex(UUID, 'Student must be a UUID'),
  disbursementId: z.string().min(1, 'Select a paid disbursement').max(200),
  invoiceId: z.string().regex(UUID, 'Invoice must be a UUID').optional().or(z.literal('')),
  currency: z.string().max(8).optional().or(z.literal('')),
});

/** Staff F2 — POST /fees/reminders/send */
export const reminderSendFormSchema = z.object({
  invoiceIds: z.array(z.string().regex(UUID)).min(1, 'Select at least one invoice'),
  channels: z
    .array(z.enum(['email', 'sms']))
    .min(1, 'Select at least one channel')
    .max(2),
  minOverdueDays: z.coerce.number().int().min(1).max(365).optional(),
  cadenceDays: z.coerce.number().int().min(0).max(90).optional(),
});

/** Staff F2 — POST /fees/reminders/suppressions */
export const reminderSuppressionFormSchema = z
  .object({
    studentId: z.string().regex(UUID).optional().or(z.literal('')),
    invoiceId: z.string().regex(UUID).optional().or(z.literal('')),
    reason: z.string().min(1, 'Reason is required').max(2000),
  })
  .refine((value) => Boolean(value.studentId?.trim() || value.invoiceId?.trim()), {
    message: 'Student or invoice UUID is required',
    path: ['studentId'],
  });

export type FeeStructureFormValues = z.infer<typeof feeStructureFormSchema>;
export type BulkInvoiceFormValues = z.infer<typeof bulkInvoiceFormSchema>;
export type ConcessionFormValues = z.infer<typeof concessionFormSchema>;
export type RefundFormValues = z.infer<typeof refundFormSchema>;
export type ReconciliationFormValues = z.infer<typeof reconciliationFormSchema>;
export type ResolveReconExceptionFormValues = z.infer<typeof resolveReconExceptionFormSchema>;
export type ScholarshipNettingFormValues = z.infer<typeof scholarshipNettingFormSchema>;
export type ReminderSendFormValues = z.infer<typeof reminderSendFormSchema>;
export type ReminderSuppressionFormValues = z.infer<typeof reminderSuppressionFormSchema>;
