'use server';

/**
 * Server Actions for transport route, vehicle, and assignment writes.
 */
import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  createDriverAssignment,
  createStudentAssignment,
  createTransportRoute,
  createTransportVehicle,
  type CreateTransportRouteInput,
  type CreateTransportVehicleInput,
} from '@/lib/api/transport';

export interface TransportActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  routeId?: string;
  vehicleId?: string;
  assignmentId?: string;
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

export async function createTransportVehicleAction(
  input: CreateTransportVehicleInput,
): Promise<TransportActionState> {
  try {
    const vehicle = await createTransportVehicle(input);
    revalidatePath('/transport');
    revalidatePath('/transport/vehicles');
    return {
      status: 'success',
      message: 'Vehicle created.',
      vehicleId: vehicle.id,
    };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create vehicle';
    return { status: 'error', message };
  }
}

export async function createDriverAssignmentAction(input: {
  vehicleId: string;
  driverId: string;
  routeId?: string;
  startDate: string;
  endDate?: string;
}): Promise<TransportActionState> {
  try {
    const row = await createDriverAssignment(input);
    revalidatePath('/transport/assignments');
    return {
      status: 'success',
      message: 'Driver assignment created.',
      assignmentId: row.id,
    };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create driver assignment';
    return { status: 'error', message };
  }
}

export async function createStudentAssignmentAction(input: {
  studentId: string;
  routeId: string;
  stopId?: string;
  startDate: string;
  endDate?: string;
}): Promise<TransportActionState> {
  try {
    const row = await createStudentAssignment(input);
    revalidatePath('/transport/assignments');
    return {
      status: 'success',
      message: 'Student assignment created.',
      assignmentId: row.id,
    };
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create student assignment';
    return { status: 'error', message };
  }
}
