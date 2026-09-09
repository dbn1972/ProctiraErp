import { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const feeStructureFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(500),
  code: z.string().max(64).optional().or(z.literal('')),
  category: z.string().min(1, 'Category is required').max(120),
  term: z.string().max(64).optional().or(z.literal('')),
  amount: z.coerce.number().min(0, 'Amount must be non-negative'),
  classId: z.string().regex(UUID, 'Class must be a UUID').optional().or(z.literal('')),
  gradeId: z.string().regex(UUID, 'Grade must be a UUID').optional().or(z.literal('')),
  partCount: z.coerce.number().int().min(1).max(24).optional(),
});

export const bulkInvoiceFormSchema = z.object({
  structureId: z.string().regex(UUID, 'Structure is required'),
  classId: z.string().regex(UUID).optional().or(z.literal('')),
  studentIds: z.string().optional(),
  dueAt: z.string().optional(),
});

export const concessionFormSchema = z.object({
  studentId: z.string().regex(UUID, 'Student must be a UUID'),
  structureId: z.string().regex(UUID, 'Structure must be a UUID'),
  invoiceId: z.string().regex(UUID).optional().or(z.literal('')),
  kind: z.enum(['percent', 'amount']),
  percent: z.coerce.number().min(0).max(100).optional(),
  amount: z.coerce.number().min(0).optional(),
  reason: z.string().min(1, 'Reason is required').max(2000),
});

export const refundFormSchema = z.object({
  invoiceId: z.string().regex(UUID, 'Invoice is required'),
  amount: z.coerce.number().gt(0, 'Amount must be greater than 0'),
  reason: z.string().min(1, 'Reason is required').max(2000),
});

export const reconciliationFormSchema = z.object({
  csv: z.string().min(1, 'CSV is required'),
  filename: z.string().max(255).optional(),
});

export type FeeStructureFormValues = z.infer<typeof feeStructureFormSchema>;
export type BulkInvoiceFormValues = z.infer<typeof bulkInvoiceFormSchema>;
export type ConcessionFormValues = z.infer<typeof concessionFormSchema>;
export type RefundFormValues = z.infer<typeof refundFormSchema>;
export type ReconciliationFormValues = z.infer<typeof reconciliationFormSchema>;
