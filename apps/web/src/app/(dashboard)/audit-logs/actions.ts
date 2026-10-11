'use server';

/**
 * Server Actions for audit retention (G-913).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { GatewayError } from '@/lib/api/gateway';
import {
  runAuditArchival,
  saveAuditRetention,
  verifyAuditChain,
  type AuditChainVerification,
} from '@/lib/api/platform.server';

import { AUDIT_RETENTION_MAX_MONTHS, minAuditRetentionMonths } from './retention-policy';

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

function buildRetentionSchema() {
  const min = minAuditRetentionMonths();
  return z.object({
    retentionMonths: z
      .number()
      .int()
      .min(min, `At least ${min} months`)
      .max(AUDIT_RETENTION_MAX_MONTHS, `At most ${AUDIT_RETENTION_MAX_MONTHS} months`),
    archivalEnabled: z.boolean(),
    archivalDestination: z.string().trim().max(500).nullable(),
  });
}

export async function saveRetentionAction(input: {
  retentionMonths: number;
  archivalEnabled: boolean;
  archivalDestination: string | null;
}): Promise<AuditActionState> {
  const parsed = buildRetentionSchema().safeParse(input);
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

/**
 * PRC-M085: full hash-chain verification is an explicit action, not part of
 * every audit-log page load, so page latency does not grow with the table.
 */
export async function verifyAuditChainAction(): Promise<{
  verification: AuditChainVerification | null;
  forbidden: boolean;
}> {
  const result = await verifyAuditChain();
  return { verification: result.data ?? null, forbidden: result.access === 'forbidden' };
}
