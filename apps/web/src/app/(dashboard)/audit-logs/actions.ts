'use server';

/**
 * Server Actions for audit retention (G-913).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { GatewayError } from '@/lib/api/gateway';
import { runAuditArchival, saveAuditRetention } from '@/lib/api/platform.server';

export interface AuditActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
}

function fail(error: unknown, fallback: string): AuditActionState {
  if (error instanceof GatewayError) {
    if (error.status === 403) {
      return { status: 'error', message: 'Platform administrator access is required.' };
    }
    return { status: 'error', message: error.message || fallback };
  }
  return { status: 'error', message: error instanceof Error ? error.message : fallback };
}

const retentionSchema = z.object({
  retentionMonths: z.number().int().min(1, 'At least 1 month').max(120, 'At most 120 months'),
  archivalEnabled: z.boolean(),
  archivalDestination: z.string().trim().max(500).nullable(),
});

export async function saveRetentionAction(
  input: z.input<typeof retentionSchema>,
): Promise<AuditActionState> {
  const parsed = retentionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.error.flatten().fieldErrors)) {
      if (v?.[0]) fieldErrors[k] = v[0];
    }
    return { status: 'error', message: 'Validation failed', fieldErrors };
  }
  try {
    await saveAuditRetention({
      ...parsed.data,
      archivalDestination: parsed.data.archivalDestination || null,
    });
    revalidatePath('/audit-logs');
    return { status: 'success', message: 'Retention policy saved' };
  } catch (error) {
    return fail(error, 'Could not save retention policy');
  }
}

export async function runArchivalAction(): Promise<AuditActionState> {
  try {
    const result = await runAuditArchival();
    revalidatePath('/audit-logs');
    return {
      status: 'success',
      message: `Archived ${result.archivedCount.toLocaleString()} entr${
        result.archivedCount === 1 ? 'y' : 'ies'
      } older than ${new Date(result.cutoffDate).toISOString().slice(0, 10)}`,
    };
  } catch (error) {
    return fail(error, 'Could not run archival');
  }
}
