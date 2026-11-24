/**
 * T-D3 — a refused transport save never shows raw gateway text.
 *
 * The gateway's RBAC refusal ("No role assignment grants 'create' on
 * 'transport' within the requested area scope") and the transport package's
 * ("Forbidden: role cannot perform transport action …") name internal
 * resources and actions. Transport forms show fixed copy plus the gateway
 * correlation id (D1b pattern) so support can find the request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const transportApi = vi.hoisted(() => ({
  createTransportRoute: vi.fn(),
  createTransportVehicle: vi.fn(),
  createDriverAssignment: vi.fn(),
  createStudentAssignment: vi.fn(),
}));
vi.mock('@/lib/api/transport', () => transportApi);

const opsApi = vi.hoisted(() => ({
  acknowledgeAlert: vi.fn(),
  createAlertRule: vi.fn(),
  createRouteStop: vi.fn(),
  createTransportFeeStructure: vi.fn(),
  deleteRouteStop: vi.fn(),
  evaluateAlerts: vi.fn(),
  ingestGpsBatch: vi.fn(),
  registerVehicleDevice: vi.fn(),
  upsertTripAttendance: vi.fn(),
}));
vi.mock('@/lib/transport/api', () => opsApi);

import { GatewayError } from '@/lib/api/gateway';
import {
  createRouteStopAction,
  createTransportRouteAction,
  createTransportVehicleAction,
  deleteRouteStopAction,
} from './actions';

const RAW_GATEWAY =
  "No role assignment grants 'create' on 'transport' within the requested area scope";
const RAW_PACKAGE = 'Forbidden: role cannot perform transport action transport.write';
const RAW_TEXT =
  /No role assignment grants|Forbidden:|within the requested area scope|transport\.write/;
const CORRELATION_ID = '2ee7694a-4534-4ad0-a4bf-44cc3f17b9d7';
const ROUTE_ID = '00000000-0000-4000-8000-0000000000a1';
const STOP_ID = '00000000-0000-4000-8000-0000000000b1';

function denied(message: string, correlationId?: string): GatewayError {
  return new GatewayError({
    status: 403,
    code: 'FORBIDDEN',
    message,
    ...(correlationId ? { correlationId } : {}),
  } as ConstructorParameters<typeof GatewayError>[0]);
}

const vehicle = { registrationNumber: 'KA-01-T-0001', capacity: 40 };

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const fn of [...Object.values(transportApi), ...Object.values(opsApi)]) fn.mockReset();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('transport denied-save copy (T-D3)', () => {
  it('a denied vehicle save shows safe copy and the gateway reference, not the RBAC reason', async () => {
    transportApi.createTransportVehicle.mockRejectedValue(denied(RAW_GATEWAY, CORRELATION_ID));
    const result = await createTransportVehicleAction(vehicle as never);
    expect(result.status).toBe('error');
    expect(result.message).not.toMatch(RAW_TEXT);
    expect(result.message).toBe(
      `You do not have permission to make this change. Contact your administrator if you need access. (ref ${CORRELATION_ID})`,
    );
  });

  it('a package-level refusal is hidden the same way', async () => {
    transportApi.createTransportRoute.mockRejectedValue(denied(RAW_PACKAGE));
    const result = await createTransportRouteAction({
      name: 'Route A',
      startLocation: 'Depot',
      endLocation: 'School',
      operatingDays: ['monday'],
    });
    expect(result.status).toBe('error');
    expect(result.message).not.toMatch(RAW_TEXT);
    expect(result.message).toMatch(
      /^You do not have permission to make this change\. Contact your administrator if you need access\. \(ref [0-9a-z]{8}\)$/,
    );
  });

  it('other gateway failures show the form fallback, never the server text', async () => {
    opsApi.createRouteStop.mockRejectedValue(
      new GatewayError({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'relation "transport_route_stops" does not exist',
        correlationId: CORRELATION_ID,
      } as ConstructorParameters<typeof GatewayError>[0]),
    );
    const result = await createRouteStopAction({ routeId: ROUTE_ID, name: 'Gate', stopOrder: 1 });
    expect(result.status).toBe('error');
    expect(result.message).toBe(`Failed to create stop (ref ${CORRELATION_ID})`);
  });

  it('a conflicting save shows fixed conflict copy, not the server text', async () => {
    transportApi.createTransportVehicle.mockRejectedValue(
      new GatewayError({
        status: 409,
        code: 'CONFLICT',
        message: 'Vehicle with registration number KA-01-T-0001 already exists',
        correlationId: CORRELATION_ID,
      } as ConstructorParameters<typeof GatewayError>[0]),
    );
    const result = await createTransportVehicleAction(vehicle as never);
    expect(result.message).toBe(
      `This conflicts with an existing record. Check the details and try again. (ref ${CORRELATION_ID})`,
    );
  });

  it('drops a correlation id that is not a safe token', async () => {
    opsApi.deleteRouteStop.mockRejectedValue(denied(RAW_GATEWAY, '<script>alert(1)</script>'));
    const result = await deleteRouteStopAction(STOP_ID, ROUTE_ID);
    expect(result.message).not.toMatch(RAW_TEXT);
    expect(result.message).not.toContain('<script>');
    expect(result.message).toMatch(/\(ref [0-9a-z]{8}\)$/);
  });

  it('logs the server reason server-side only', async () => {
    transportApi.createTransportVehicle.mockRejectedValue(denied(RAW_GATEWAY, CORRELATION_ID));
    await createTransportVehicleAction(vehicle as never);
    expect(consoleError).toHaveBeenCalled();
    expect(String(consoleError.mock.calls[0]?.[0])).toContain(CORRELATION_ID);
  });
});
