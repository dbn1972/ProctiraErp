'use server';

/**
 * Server Actions for scholarship program updates and disbursement retries.
 */
import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  createScholarshipProgram,
  updateDisbursement,
  updateScholarshipProgram,
  type CreateScholarshipProgramInput,
  type UpdateScholarshipProgramInput,
} from '@/lib/api/scholarships';

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

export async function retryFailedDisbursementsAction(
  ids: string[],
): Promise<ScholarshipActionState> {
  if (ids.length === 0) {
    return { status: 'error', message: 'No failed transfers to retry.' };
  }

  const errors: string[] = [];
  for (const id of ids) {
    try {
      await updateDisbursement(id, {
        paymentStatus: 'scheduled',
        notes: 'Retry queued from disbursements UI',
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Failed to retry ${id}`);
    }
  }

  revalidatePath('/scholarships/disbursements');

  if (errors.length === ids.length) {
    return { status: 'error', message: errors[0] ?? 'Retry failed.' };
  }
  if (errors.length > 0) {
    return {
      status: 'success',
      message: `Retried ${ids.length - errors.length} of ${ids.length} transfers.`,
    };
  }
  return {
    status: 'success',
    message: `Queued ${ids.length} transfer${ids.length === 1 ? '' : 's'} for retry.`,
  };
}
