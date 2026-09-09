'use server';

/**
 * Server Actions for reports generate / schedules (G-909).
 */
import { revalidatePath } from 'next/cache';

import { createImportJob, type CreateImportJobInput } from '@/lib/api/data-warehouse';
import {
  createReportSchedule,
  deleteReportSchedule,
  generateReport,
  runDueReportSchedules,
  runReportSchedule,
  setReportScheduleEnabled,
  type GenerateReportInput,
} from '@/lib/reports/api';
import {
  createReportScheduleFormSchema,
  generateReportFormSchema,
  patchReportScheduleFormSchema,
  scheduleIdFormSchema,
} from '@/lib/reports/validation';

export interface InsightsActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
  artifactId?: string;
  sha256?: string;
  source?: 'gateway' | 'scaffold';
  fieldErrors?: Record<string, string>;
}

function zodFlatten(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value && value.length > 0 && value[0]) out[key] = value[0];
  }
  return out;
}

export async function generateReportAction(
  input: GenerateReportInput,
): Promise<InsightsActionState> {
  const parsed = generateReportFormSchema.safeParse({
    templateId: input.templateId ?? input.reportKey ?? '',
    format: input.format,
    filters: input.filters,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  const result = await generateReport({
    templateId: parsed.data.templateId,
    format: parsed.data.format === 'pdf' || parsed.data.format === 'PDF'
      ? 'PDF'
      : parsed.data.format === 'xlsx' || parsed.data.format === 'XLSX'
        ? 'XLSX'
        : 'CSV',
    filters: parsed.data.filters,
  });
  if (!result.run) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to generate report',
      source: result.source,
    };
  }
  revalidatePath('/reports');
  revalidatePath('/reports/schedules');
  revalidatePath(`/reports/${result.run.templateId}/results`);
  return {
    status: 'success',
    message: `Report ready (${result.run.status}). SHA-256 ${result.run.sha256 ?? 'n/a'}.`,
    id: result.run.id,
    artifactId: result.run.artifactId ?? undefined,
    sha256: result.run.sha256 ?? undefined,
    source: result.source,
  };
}

export async function createImportJobAction(
  input: CreateImportJobInput,
): Promise<InsightsActionState> {
  const result = await createImportJob(input);
  if (!result.job) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to create import job',
      source: result.source,
    };
  }
  revalidatePath('/data-warehouse/import');
  return {
    status: 'success',
    message: `Import job ${result.job.status}.`,
    id: result.job.id,
    source: result.source,
  };
}

export async function createReportScheduleAction(form: {
  reportKey: string;
  format: string;
  cadence: string;
  hour: number | string;
  recipients: string;
  enabled?: boolean;
}): Promise<InsightsActionState> {
  const parsed = createReportScheduleFormSchema.safeParse(form);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  const result = await createReportSchedule({
    reportKey: parsed.data.reportKey,
    format: parsed.data.format,
    cadence: parsed.data.cadence,
    hour: parsed.data.hour,
    recipients: parsed.data.recipients,
    enabled: parsed.data.enabled ?? true,
  });
  if (!result.schedule) {
    return { status: 'error', message: result.error ?? 'Failed to create schedule', source: result.source };
  }
  revalidatePath('/reports/schedules');
  return {
    status: 'success',
    message: `Schedule ${result.schedule.cadence} at ${result.schedule.hour}:00 UTC.`,
    id: result.schedule.id,
    source: result.source,
  };
}

export async function toggleReportScheduleAction(
  scheduleId: string,
  enabled: boolean,
): Promise<InsightsActionState> {
  const parsed = patchReportScheduleFormSchema.safeParse({ scheduleId, enabled });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid schedule' };
  }
  const result = await setReportScheduleEnabled(parsed.data.scheduleId, parsed.data.enabled);
  if (!result.schedule) {
    return { status: 'error', message: result.error ?? 'Failed to update schedule' };
  }
  revalidatePath('/reports/schedules');
  return {
    status: 'success',
    message: parsed.data.enabled ? 'Schedule enabled' : 'Schedule paused',
    id: result.schedule.id,
  };
}

export async function deleteReportScheduleAction(scheduleId: string): Promise<InsightsActionState> {
  const parsed = scheduleIdFormSchema.safeParse({ scheduleId });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid schedule' };
  }
  const result = await deleteReportSchedule(parsed.data.scheduleId);
  if (!result.ok) {
    return { status: 'error', message: result.error ?? 'Failed to delete schedule' };
  }
  revalidatePath('/reports/schedules');
  return { status: 'success', message: 'Schedule deleted' };
}

export async function runReportScheduleAction(scheduleId: string): Promise<InsightsActionState> {
  const parsed = scheduleIdFormSchema.safeParse({ scheduleId });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid schedule' };
  }
  const result = await runReportSchedule(parsed.data.scheduleId);
  if (!result.run) {
    return { status: 'error', message: result.error ?? 'Failed to run schedule' };
  }
  revalidatePath('/reports/schedules');
  revalidatePath(`/reports/${result.run.templateId}/results`);
  return {
    status: 'success',
    message: `Scheduled run ${result.run.trigger ?? 'schedule'} (${result.run.status}).`,
    id: result.run.id,
  };
}

export async function runDueSchedulesAction(): Promise<InsightsActionState> {
  const result = await runDueReportSchedules();
  if (!result) {
    return { status: 'error', message: 'Could not tick due schedules' };
  }
  revalidatePath('/reports/schedules');
  revalidatePath('/reports');
  return {
    status: 'success',
    message: `Due ${result.due}: ${result.completed} completed, ${result.failed} failed.`,
  };
}
