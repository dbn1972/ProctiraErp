'use server';

/**
 * Server Actions for scholarship program updates and disbursement retries.
 */
import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  approveScholarshipApplication,
  createScholarshipProgram,
  rejectScholarshipApplication,
  updateDisbursement,
  updateScholarshipProgram,
  type CreateScholarshipProgramInput,
  type UpdateScholarshipProgramInput,
} from '@/lib/api/scholarships';

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
