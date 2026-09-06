'use server';

/**
 * Server Actions for Insights write proofs (reports generate / warehouse import).
 */
import { revalidatePath } from 'next/cache';

import {
  createImportJob,
  type CreateImportJobInput,
} from '@/lib/api/data-warehouse';
import {
  generateReport,
  type GenerateReportInput,
} from '@/lib/api/reports';

export interface InsightsActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
  source?: 'gateway' | 'scaffold';
}

export async function generateReportAction(
  input: GenerateReportInput,
): Promise<InsightsActionState> {
  const result = await generateReport(input);
  if (!result.run) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to generate report',
      source: result.source,
    };
  }
  revalidatePath('/reports');
  revalidatePath(`/reports/${result.run.templateId}/results`);
  return {
    status: 'success',
    message: `Report queued (${result.run.status}).`,
    id: result.run.id,
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
