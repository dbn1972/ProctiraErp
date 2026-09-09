'use server';

/**
 * Server Actions for transport route, vehicle, assignment, and G-920 ops writes.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { GatewayError } from '@/lib/api/gateway';
import {
  createDriverAssignment,
  createStudentAssignment,
  createTransportRoute,
  createTransportVehicle,
  type CreateTransportRouteInput,
  type CreateTransportVehicleInput,
} from '@/lib/api/transport';
import {
  acknowledgeAlert,
  createAlertRule,
  createRouteStop,
  createTransportFeeStructure,
  deleteRouteStop,
  evaluateAlerts,
  ingestGpsBatch,
  registerVehicleDevice,
  upsertTripAttendance,
} from '@/lib/transport/api';

export interface TransportActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  routeId?: string;
  vehicleId?: string;
  assignmentId?: string;
  deviceKey?: string;
  deviceId?: string;
}

const uuid = z.string().uuid();
const hm = z.string().regex(/^\d{2}:\d{2}$/);

function fail(error: unknown, fallback: string): TransportActionState {
  const message =
    error instanceof GatewayError
      ? error.message
      : error instanceof Error
        ? error.message
        : fallback;
  return { status: 'error', message };
}

export async function createTransportRouteAction(
  input: CreateTransportRouteInput,
): Promise<TransportActionState> {
  try {
    const route = await createTransportRoute(input);
    revalidatePath('/transport');
    revalidatePath('/transport/routes');
    revalidatePath(`/transport/routes/${route.id}`);
    return { status: 'success', message: 'Route created.', routeId: route.id };
  } catch (error) {
    return fail(error, 'Failed to create route');
  }
}

export async function createTransportVehicleAction(
  input: CreateTransportVehicleInput,
): Promise<TransportActionState> {
  try {
    const vehicle = await createTransportVehicle(input);
    revalidatePath('/transport');
    revalidatePath('/transport/vehicles');
    return { status: 'success', message: 'Vehicle created.', vehicleId: vehicle.id };
  } catch (error) {
    return fail(error, 'Failed to create vehicle');
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
    return { status: 'success', message: 'Driver assignment created.', assignmentId: row.id };
  } catch (error) {
    return fail(error, 'Failed to create driver assignment');
  }
}

const studentAssignmentSchema = z.object({
  studentId: uuid,
  routeId: uuid,
  stopId: uuid.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function createStudentAssignmentAction(input: {
  studentId: string;
  routeId: string;
  stopId?: string;
  startDate: string;
  endDate?: string;
}): Promise<TransportActionState> {
  const parsed = studentAssignmentSchema.safeParse({
    ...input,
    stopId: input.stopId || undefined,
    endDate: input.endDate || undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid assignment' };
  }
  try {
    const row = await createStudentAssignment(parsed.data);
    revalidatePath('/transport/assignments');
    revalidatePath('/transport/fees');
    return { status: 'success', message: 'Student assignment created.', assignmentId: row.id };
  } catch (error) {
    return fail(error, 'Failed to create student assignment');
  }
}

const createStopSchema = z.object({
  routeId: uuid,
  name: z.string().min(1).max(255),
  stopOrder: z.number().int().min(1).max(999),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  pickupTime: hm.optional(),
  dropoffTime: hm.optional(),
});

export async function createRouteStopAction(
  input: z.infer<typeof createStopSchema>,
): Promise<TransportActionState> {
  const parsed = createStopSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid stop' };
  }
  try {
    await createRouteStop(parsed.data);
    revalidatePath('/transport/routes');
    revalidatePath(`/transport/routes/${parsed.data.routeId}/stops`);
    revalidatePath('/transport/live');
    return { status: 'success', message: 'Stop created.' };
  } catch (error) {
    return fail(error, 'Failed to create stop');
  }
}

export async function deleteRouteStopAction(id: string, routeId: string): Promise<TransportActionState> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { status: 'error', message: 'Invalid stop id' };
  try {
    await deleteRouteStop(id);
    revalidatePath(`/transport/routes/${routeId}/stops`);
    revalidatePath('/transport/live');
    return { status: 'success', message: 'Stop deleted.' };
  } catch (error) {
    return fail(error, 'Failed to delete stop');
  }
}

export async function registerVehicleDeviceAction(
  vehicleId: string,
  deviceId?: string,
): Promise<TransportActionState> {
  const parsed = uuid.safeParse(vehicleId);
  if (!parsed.success) return { status: 'error', message: 'Invalid vehicle id' };
  try {
    const device = await registerVehicleDevice(vehicleId, deviceId);
    revalidatePath('/transport/vehicles');
    revalidatePath('/transport/live');
    return {
      status: 'success',
      message: 'Device registered. Copy the key now — it is not stored in plaintext.',
      deviceKey: device.deviceKey,
      deviceId: device.deviceId,
      vehicleId,
    };
  } catch (error) {
    return fail(error, 'Failed to register device');
  }
}

const gpsSchema = z.object({
  deviceId: z.string().min(1),
  deviceKey: z.string().min(1),
  pingId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function ingestGpsPingAction(
  input: z.infer<typeof gpsSchema>,
): Promise<TransportActionState> {
  const parsed = gpsSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid ping' };
  }
  try {
    await ingestGpsBatch(
      {
        deviceId: parsed.data.deviceId,
        pings: [
          {
            pingId: parsed.data.pingId,
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude,
          },
        ],
      },
      parsed.data.deviceKey,
    );
    revalidatePath('/transport/live');
    return { status: 'success', message: 'GPS ping recorded.' };
  } catch (error) {
    return fail(error, 'Failed to ingest GPS');
  }
}

export async function refreshLiveMapAction(): Promise<TransportActionState> {
  revalidatePath('/transport/live');
  return { status: 'success', message: 'Live map refreshed.' };
}

const attendanceSchema = z.object({
  routeId: uuid,
  tripDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  direction: z.enum(['pickup', 'drop']),
  studentId: uuid,
  stopId: uuid.optional(),
  status: z.enum(['boarded', 'alighted', 'absent']),
});

export async function upsertTripAttendanceAction(
  input: z.infer<typeof attendanceSchema>,
): Promise<TransportActionState> {
  const parsed = attendanceSchema.safeParse({
    ...input,
    stopId: input.stopId || undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid attendance' };
  }
  try {
    await upsertTripAttendance(parsed.data);
    revalidatePath('/transport/attendance');
    return { status: 'success', message: 'Attendance saved.' };
  } catch (error) {
    return fail(error, 'Failed to record attendance');
  }
}

const alertRuleSchema = z.object({
  kind: z.enum(['delay_minutes', 'geofence_exit', 'missed_pickup']),
  threshold: z.number().min(0),
  routeId: uuid.optional(),
});

export async function createAlertRuleAction(
  input: z.infer<typeof alertRuleSchema>,
): Promise<TransportActionState> {
  const parsed = alertRuleSchema.safeParse({
    ...input,
    routeId: input.routeId || undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid rule' };
  }
  try {
    await createAlertRule({ ...parsed.data, channels: ['in_app'] });
    revalidatePath('/transport/alerts');
    return { status: 'success', message: 'Alert rule created.' };
  } catch (error) {
    return fail(error, 'Failed to create rule');
  }
}

export async function evaluateAlertsAction(routeId?: string): Promise<TransportActionState> {
  try {
    const result = await evaluateAlerts({
      tripDate: new Date().toISOString().slice(0, 10),
      routeId: routeId || undefined,
    });
    revalidatePath('/transport/alerts');
    return { status: 'success', message: `Evaluated ${result.evaluated} alert(s).` };
  } catch (error) {
    return fail(error, 'Failed to evaluate alerts');
  }
}

export async function acknowledgeAlertAction(id: string): Promise<TransportActionState> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { status: 'error', message: 'Invalid alert id' };
  try {
    await acknowledgeAlert(id);
    revalidatePath('/transport/alerts');
    return { status: 'success', message: 'Alert acknowledged.' };
  } catch (error) {
    return fail(error, 'Failed to acknowledge');
  }
}

const feeBandSchema = z.object({
  name: z.string().min(1).max(255),
  routeId: uuid.optional(),
  stopId: uuid.optional(),
  minDistanceKm: z.number().min(0).optional(),
  maxDistanceKm: z.number().min(0).optional(),
  amountCents: z.number().int().min(0),
  currency: z.string().length(3).optional(),
});

export async function createTransportFeeStructureAction(
  input: z.infer<typeof feeBandSchema>,
): Promise<TransportActionState> {
  const parsed = feeBandSchema.safeParse({
    ...input,
    routeId: input.routeId || undefined,
    stopId: input.stopId || undefined,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid fee band' };
  }
  try {
    await createTransportFeeStructure(parsed.data);
    revalidatePath('/transport/fees');
    return { status: 'success', message: 'Fee band created (Fees category=transport when G-903 is wired).' };
  } catch (error) {
    return fail(error, 'Failed to create fee band');
  }
}
