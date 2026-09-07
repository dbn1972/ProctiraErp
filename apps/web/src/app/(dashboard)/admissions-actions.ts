'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import { bookInterview, createInterviewSlot, updateApplicationStatus } from '@/lib/api/admissions';

export interface AdmissionsActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
}

export async function updateApplicationStatusAction(input: {
  id: string;
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'waitlisted';
  remarks?: string;
}): Promise<AdmissionsActionState> {
  try {
    await updateApplicationStatus(input.id, input.status, input.remarks);
    revalidatePath('/admissions');
    return { status: 'success', message: `Status set to ${input.status}.`, id: input.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to update status',
    };
  }
}

export async function createInterviewSlotAction(input: {
  institutionId: string;
  startsAt: string;
  endsAt: string;
  capacity?: number;
  location?: string;
}): Promise<AdmissionsActionState> {
  try {
    const slot = await createInterviewSlot(input);
    revalidatePath('/admissions');
    return { status: 'success', message: 'Interview slot created.', id: slot.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create slot',
    };
  }
}

export async function bookInterviewAction(input: {
  slotId: string;
  applicationId: string;
}): Promise<AdmissionsActionState> {
  try {
    const booking = await bookInterview(input);
    revalidatePath('/admissions');
    return { status: 'success', message: 'Interview booked.', id: booking.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to book interview',
    };
  }
}
