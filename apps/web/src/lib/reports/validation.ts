import { z } from 'zod';

export const reportFormatSchema = z.enum(['PDF', 'XLSX', 'CSV', 'pdf', 'xlsx', 'csv']);

export const generateReportFormSchema = z.object({
  templateId: z.string().min(1, 'Select a report template').max(100),
  format: reportFormatSchema,
  filters: z.record(z.string(), z.string()).optional(),
});

export const createReportScheduleFormSchema = z.object({
  reportKey: z.string().min(1, 'Select a report').max(100),
  format: reportFormatSchema,
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  hour: z.coerce.number().int().min(0).max(23),
  recipients: z
    .string()
    .min(1, 'Enter at least one recipient email')
    .max(2000)
    .transform((raw) =>
      raw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().email('Invalid recipient email')).min(1)),
  enabled: z.coerce.boolean().optional(),
});

export const patchReportScheduleFormSchema = z.object({
  scheduleId: z.string().uuid(),
  enabled: z.coerce.boolean(),
});

export const scheduleIdFormSchema = z.object({
  scheduleId: z.string().uuid(),
});

export type GenerateReportFormValues = z.infer<typeof generateReportFormSchema>;
export type CreateReportScheduleFormValues = z.input<typeof createReportScheduleFormSchema>;
