'use server';

import { revalidatePath } from 'next/cache';
import { parseActionInput } from '@/lib/validation/server-action-input';
import {
  staffLeaveDecisionSchema,
  staffLeaveInputSchema,
} from '@/lib/validation/dashboard-action-schemas';

import { GatewayError } from '@/lib/api/gateway';
import { createStaffLeave, decideStaffLeave, type CreateStaffLeaveInput } from '@/lib/api/staff';

export interface StaffActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
}

export async function createStaffLeaveAction(
  input: CreateStaffLeaveInput,
): Promise<StaffActionState> {
  const parsed = parseActionInput(staffLeaveInputSchema, input);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  input = parsed.data;
  try {
    const row = await createStaffLeave(input);
    revalidatePath('/staff/leaves');
    return { status: 'success', message: 'Leave request recorded.', id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create leave',
    };
  }
}

export async function decideStaffLeaveAction(
  id: string,
  status: 'approved' | 'rejected',
): Promise<StaffActionState> {
  const parsed = parseActionInput(staffLeaveDecisionSchema, { id, status });
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  try {
    const row = await decideStaffLeave(id, status);
    revalidatePath('/staff/leaves');
    return {
      status: 'success',
      message: status === 'approved' ? 'Leave approved.' : 'Leave rejected.',
      id: row.id,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to decide leave',
    };
  }
}
