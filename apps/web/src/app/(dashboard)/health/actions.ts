'use server';

/**
 * Server Actions for Health redesign write paths.
 */
import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  createCounsellingSession,
  type CreateCounsellingSessionInput,
} from '@/lib/api/health';

export interface HealthActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  sessionId?: string;
}

export async function createCounsellingSessionAction(
  input: CreateCounsellingSessionInput,
): Promise<HealthActionState> {
  try {
    const session = await createCounsellingSession(input);
    revalidatePath('/health/counselling');
    revalidatePath('/health/counselling/new');
    return {
      status: 'success',
      message: 'Counselling session scheduled.',
      sessionId: session.id,
    };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create counselling session';
    return { status: 'error', message };
  }
}
