'use server';

/**
 * Server Actions for scholarship program updates and disbursement retries.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { GatewayError } from '@/lib/api/gateway';
import {
  approveScholarshipApplication,
  createScholarshipProgram,
  listScholarshipDisbursements,
  rejectScholarshipApplication,
  updateDisbursement,
  updateScholarshipProgram,
  type CreateScholarshipProgramInput,
  type UpdateScholarshipProgramInput,
} from '@/lib/api/scholarships';
import { buildPaidUpdateBody } from '@/features/scholarships/disbursement-paid';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMMENT = 2000;

export interface ScholarshipActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  programId?: string;
}

export async function createScholarshipProgramAction(
  input: CreateScholarshipProgramInput,
): Promise<ScholarshipActionState> {
  try {
    const program = await createScholarshipProgram(input);
    revalidatePath('/scholarships');
    revalidatePath(`/scholarships/programs/${program.id}`);
    return {
      status: 'success',
      message: 'Program created.',
      programId: program.id,
    };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create program';
    return { status: 'error', message };
  }
}

export async function updateScholarshipProgramAction(
  id: string,
  input: UpdateScholarshipProgramInput,
): Promise<ScholarshipActionState> {
  try {
    await updateScholarshipProgram(id, input);
    revalidatePath(`/scholarships/programs/${id}`);
    revalidatePath('/scholarships');
    return { status: 'success', message: 'Program updated.' };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to update program';
    return { status: 'error', message };
  }
}

/**
 * G-911 — approve / reject a scholarship application with an optional
 * reviewer comment. Approval also queues the first instalment on the gateway.
 */
export async function decideApplicationAction(input: {
  applicationId: string;
  decision: 'approve' | 'reject';
  comment?: string;
}): Promise<ScholarshipActionState> {
  if (!UUID_RE.test(input.applicationId)) {
    return { status: 'error', message: 'Invalid application id.' };
  }
  if (input.decision !== 'approve' && input.decision !== 'reject') {
    return { status: 'error', message: 'Unknown decision.' };
  }
  const comment = input.comment?.trim() ?? '';
  if (comment.length > MAX_COMMENT) {
    return { status: 'error', message: `Comment must be at most ${MAX_COMMENT} characters.` };
  }

  try {
    const payload = comment ? { comment } : {};
    const application =
      input.decision === 'approve'
        ? await approveScholarshipApplication(input.applicationId, payload)
        : await rejectScholarshipApplication(input.applicationId, payload);
    revalidatePath(`/scholarships/applications/${input.applicationId}`);
    revalidatePath('/scholarships/applications');
    revalidatePath('/scholarships/disbursements');
    revalidatePath(`/scholarships/programs/${application.programId}`);
    revalidatePath('/scholarships');
    return {
      status: 'success',
      message:
        input.decision === 'approve'
          ? 'Application approved — first instalment scheduled.'
          : 'Application rejected.',
    };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : `Failed to ${input.decision} application`;
    return { status: 'error', message };
  }
}

/** PRC-M481: ids are UUIDs, at most 100 per retry. */
const retryIdsSchema = z.array(z.string().uuid()).min(1).max(100);

export interface RetryDisbursementResult {
  id: string;
  outcome: 'queued' | 'skipped' | 'failed';
  reason?: string;
}

/**
 * PRC-M481: re-queue *failed* transfers only. Client-supplied ids are validated,
 * then re-checked against the tenant's own disbursements on the server: unknown
 * ids (including another tenant's) and anything not currently FAILED are skipped
 * and never PUT, so a paid transfer can't be pushed back to scheduled. The re-check
 * also makes a double-click idempotent — the second call finds nothing FAILED.
 */
export async function retryFailedDisbursementsAction(
  ids: string[],
): Promise<ScholarshipActionState & { results?: RetryDisbursementResult[] }> {
  const parsed = retryIdsSchema.safeParse(ids);
  if (!parsed.success) {
    return {
      status: 'error',
      message:
        ids.length === 0
          ? 'No failed transfers to retry.'
          : 'Select between 1 and 100 valid transfers to retry.',
    };
  }
  const unique = [...new Set(parsed.data)];
  let current: Awaited<ReturnType<typeof listScholarshipDisbursements>>;
  try {
    current = await listScholarshipDisbursements();
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not load disbursements.',
    };
  }
  const byId = new Map(current.map((row) => [row.id, row]));
  const results: RetryDisbursementResult[] = [];
  for (const id of unique) {
    const row = byId.get(id);
    if (!row) {
      results.push({ id, outcome: 'skipped', reason: 'not found' });
      continue;
    }
    if (row.status !== 'FAILED') {
      results.push({ id, outcome: 'skipped', reason: `status is ${row.status.toLowerCase()}` });
      continue;
    }
    try {
      await updateDisbursement(id, {
        paymentStatus: 'scheduled',
        notes: 'Retry queued from disbursements UI',
      });
      results.push({ id, outcome: 'queued' });
    } catch (error) {
      results.push({
        id,
        outcome: 'failed',
        reason: error instanceof Error ? error.message : 'retry failed',
      });
    }
  }
  revalidatePath('/scholarships/disbursements');
  const queued = results.filter((r) => r.outcome === 'queued').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  const failed = results.filter((r) => r.outcome === 'failed');
  if (queued === 0) {
    return {
      status: 'error',
      message:
        failed[0]?.reason ??
        (skipped > 0
          ? 'None of the selected transfers are failed; nothing was retried.'
          : 'Retry failed.'),
      results,
    };
  }
  const parts = [
    `Queued ${queued} of ${unique.length} transfer${unique.length === 1 ? '' : 's'} for retry.`,
  ];
  if (skipped > 0) parts.push(`${skipped} skipped (not failed).`);
  if (failed.length > 0) parts.push(`${failed.length} could not be retried.`);
  return { status: 'success', message: parts.join(' '), results };
}
/**
 * Mark a disbursement paid. The backend requires a transaction reference and
 * paid date for the `paid` transition (PRC-H085), so both are validated here.
 */
export async function markDisbursementPaidAction(
  id: string,
  input: { transactionReference: string; paidDate: string },
): Promise<ScholarshipActionState> {
  if (!UUID_RE.test(id)) {
    return { status: 'error', message: 'Invalid disbursement id.' };
  }
  const built = buildPaidUpdateBody(input);
  if (!built.ok) {
    return { status: 'error', message: built.error };
  }
  try {
    await updateDisbursement(id, built.body);
    revalidatePath('/scholarships/disbursements');
    return { status: 'success', message: 'Disbursement marked paid.' };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to mark disbursement paid';
    return { status: 'error', message };
  }
}
