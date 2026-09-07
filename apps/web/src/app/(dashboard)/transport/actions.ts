'use server';

/**
 * Server Actions for transport route writes.
 */
import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import { createTransportRoute, type CreateTransportRouteInput } from '@/lib/api/transport';

export interface TransportActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  routeId?: string;
}

export async function createTransportRouteAction(
  input: CreateTransportRouteInput,
): Promise<TransportActionState> {
  try {
    const route = await createTransportRoute(input);
    revalidatePath('/transport');
    revalidatePath('/transport/routes');
    revalidatePath(`/transport/routes/${route.id}`);
    return {
      status: 'success',
      message: 'Route created.',
      routeId: route.id,
    };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create route';
    return { status: 'error', message };
  }
}
