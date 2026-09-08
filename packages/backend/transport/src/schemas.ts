/**
 * Typebox schemas for Transport Service request/response validation.
 *
 * Defines schemas for:
 * - Transport route CRUD (routes with stops and schedules)
 * - Vehicle management (registration, capacity, status)
 * - Driver assignments (vehicle-driver-route linking)
 * - Student route assignments (student-route-stop linking)
 *
 * Requirements: 1.2 (Transport_Module)
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── UUID Pattern ────────────────────────────────────────────────────────────

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Transport Route Schemas ─────────────────────────────────────────────────

/**
 * Schema for creating a new transport route.
 */
export const CreateTransportRouteSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Route name' }),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Route description' })),
  startLocation: Type.String({ minLength: 1, maxLength: 500, description: 'Starting location' }),
  endLocation: Type.String({ minLength: 1, maxLength: 500, description: 'Ending location' }),
  distanceKm: Type.Optional(Type.Number({ minimum: 0, description: 'Distance in kilometers' })),
  estimatedDurationMinutes: Type.Optional(
    Type.Number({ minimum: 1, maximum: 1440, description: 'Estimated duration in minutes' }),
  ),
  operatingDays: Type.Array(
    Type.String({
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    }),
    { minItems: 1, maxItems: 7, description: 'Days the route operates' },
  ),
  departureTime: Type.Optional(
    Type.String({ pattern: '^\\d{2}:\\d{2}$', description: 'Departure time (HH:MM)' }),
  ),
  returnTime: Type.Optional(
    Type.String({ pattern: '^\\d{2}:\\d{2}$', description: 'Return time (HH:MM)' }),
  ),
  institutionId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Associated institution UUID' }),
  ),
});

export type CreateTransportRouteInput = Static<typeof CreateTransportRouteSchema>;

/**
 * Schema for updating a transport route.
 */
export const UpdateTransportRouteSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Route name' })),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Route description' })),
  status: Type.Optional(
    Type.String({ enum: ['active', 'inactive', 'suspended'], description: 'Route status' }),
  ),
  startLocation: Type.Optional(
    Type.String({ minLength: 1, maxLength: 500, description: 'Starting location' }),
  ),
  endLocation: Type.Optional(
    Type.String({ minLength: 1, maxLength: 500, description: 'Ending location' }),
  ),
  distanceKm: Type.Optional(Type.Number({ minimum: 0, description: 'Distance in kilometers' })),
  estimatedDurationMinutes: Type.Optional(
    Type.Number({ minimum: 1, maximum: 1440, description: 'Estimated duration in minutes' }),
  ),
  operatingDays: Type.Optional(
    Type.Array(
      Type.String({
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      }),
      { minItems: 1, maxItems: 7, description: 'Days the route operates' },
    ),
  ),
  departureTime: Type.Optional(
    Type.String({ pattern: '^\\d{2}:\\d{2}$', description: 'Departure time (HH:MM)' }),
  ),
  returnTime: Type.Optional(
    Type.String({ pattern: '^\\d{2}:\\d{2}$', description: 'Return time (HH:MM)' }),
  ),
  institutionId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Associated institution UUID' }),
  ),
});

export type UpdateTransportRouteInput = Static<typeof UpdateTransportRouteSchema>;

// ─── Route Stop Schemas ──────────────────────────────────────────────────────

/**
 * Schema for creating a route stop.
 */
export const CreateRouteStopSchema = Type.Object({
  routeId: Type.String({ pattern: UUID_PATTERN, description: 'Transport route UUID' }),
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Stop name' }),
  latitude: Type.Optional(Type.Number({ minimum: -90, maximum: 90, description: 'Latitude' })),
  longitude: Type.Optional(Type.Number({ minimum: -180, maximum: 180, description: 'Longitude' })),
  stopOrder: Type.Number({
    minimum: 1,
    maximum: 999,
    description: 'Order of the stop in the route',
  }),
  pickupTime: Type.Optional(
    Type.String({ pattern: '^\\d{2}:\\d{2}$', description: 'Pickup time (HH:MM)' }),
  ),
  dropoffTime: Type.Optional(
    Type.String({ pattern: '^\\d{2}:\\d{2}$', description: 'Dropoff time (HH:MM)' }),
  ),
});

export type CreateRouteStopInput = Static<typeof CreateRouteStopSchema>;

/**
 * Schema for updating a route stop.
 */
export const UpdateRouteStopSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Stop name' })),
  latitude: Type.Optional(Type.Number({ minimum: -90, maximum: 90, description: 'Latitude' })),
  longitude: Type.Optional(Type.Number({ minimum: -180, maximum: 180, description: 'Longitude' })),
  stopOrder: Type.Optional(
    Type.Number({ minimum: 1, maximum: 999, description: 'Order of the stop' }),
  ),
  pickupTime: Type.Optional(
    Type.String({ pattern: '^\\d{2}:\\d{2}$', description: 'Pickup time (HH:MM)' }),
  ),
  dropoffTime: Type.Optional(
    Type.String({ pattern: '^\\d{2}:\\d{2}$', description: 'Dropoff time (HH:MM)' }),
  ),
});

export type UpdateRouteStopInput = Static<typeof UpdateRouteStopSchema>;

// ─── Vehicle Schemas ─────────────────────────────────────────────────────────

/**
 * Schema for creating a vehicle record.
 */
export const CreateVehicleSchema = Type.Object({
  registrationNumber: Type.String({
    minLength: 1,
    maxLength: 50,
    description: 'Vehicle registration number',
  }),
  make: Type.Optional(Type.String({ maxLength: 100, description: 'Vehicle make/manufacturer' })),
  model: Type.Optional(Type.String({ maxLength: 100, description: 'Vehicle model' })),
  year: Type.Optional(
    Type.Number({ minimum: 1900, maximum: 2100, description: 'Manufacturing year' }),
  ),
  capacity: Type.Number({ minimum: 1, maximum: 200, description: 'Passenger capacity' }),
  insuranceExpiry: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Insurance expiry date (YYYY-MM-DD)',
    }),
  ),
  lastServiceDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Last service date (YYYY-MM-DD)',
    }),
  ),
});

export type CreateVehicleInput = Static<typeof CreateVehicleSchema>;

/**
 * Schema for updating a vehicle record.
 */
export const UpdateVehicleSchema = Type.Object({
  registrationNumber: Type.Optional(
    Type.String({ minLength: 1, maxLength: 50, description: 'Vehicle registration number' }),
  ),
  make: Type.Optional(Type.String({ maxLength: 100, description: 'Vehicle make/manufacturer' })),
  model: Type.Optional(Type.String({ maxLength: 100, description: 'Vehicle model' })),
  year: Type.Optional(
    Type.Number({ minimum: 1900, maximum: 2100, description: 'Manufacturing year' }),
  ),
  capacity: Type.Optional(
    Type.Number({ minimum: 1, maximum: 200, description: 'Passenger capacity' }),
  ),
  status: Type.Optional(
    Type.String({
      enum: ['active', 'inactive', 'maintenance', 'retired'],
      description: 'Vehicle status',
    }),
  ),
  insuranceExpiry: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Insurance expiry date (YYYY-MM-DD)',
    }),
  ),
  lastServiceDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Last service date (YYYY-MM-DD)',
    }),
  ),
});

export type UpdateVehicleInput = Static<typeof UpdateVehicleSchema>;

// ─── Driver Assignment Schemas ───────────────────────────────────────────────

/**
 * Schema for creating a driver assignment.
 */
export const CreateDriverAssignmentSchema = Type.Object({
  vehicleId: Type.String({ pattern: UUID_PATTERN, description: 'Vehicle UUID' }),
  driverId: Type.String({ pattern: UUID_PATTERN, description: 'Driver (staff) UUID' }),
  routeId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Transport route UUID' }),
  ),
  startDate: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Assignment start date (YYYY-MM-DD)',
  }),
  endDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Assignment end date (YYYY-MM-DD)',
    }),
  ),
});

export type CreateDriverAssignmentInput = Static<typeof CreateDriverAssignmentSchema>;

/**
 * Schema for updating a driver assignment.
 */
export const UpdateDriverAssignmentSchema = Type.Object({
  routeId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Transport route UUID' }),
  ),
  endDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Assignment end date (YYYY-MM-DD)',
    }),
  ),
  isActive: Type.Optional(Type.Boolean({ description: 'Whether the assignment is active' })),
});

export type UpdateDriverAssignmentInput = Static<typeof UpdateDriverAssignmentSchema>;

// ─── Student Route Assignment Schemas ────────────────────────────────────────

/**
 * Schema for assigning a student to a transport route.
 */
export const CreateStudentAssignmentSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN, description: 'Student UUID' }),
  routeId: Type.String({ pattern: UUID_PATTERN, description: 'Transport route UUID' }),
  stopId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Route stop UUID' })),
  startDate: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Assignment start date (YYYY-MM-DD)',
  }),
  endDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Assignment end date (YYYY-MM-DD)',
    }),
  ),
});

export type CreateStudentAssignmentInput = Static<typeof CreateStudentAssignmentSchema>;

/**
 * Schema for updating a student route assignment.
 */
export const UpdateStudentAssignmentSchema = Type.Object({
  stopId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Route stop UUID' })),
  endDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Assignment end date (YYYY-MM-DD)',
    }),
  ),
  isActive: Type.Optional(Type.Boolean({ description: 'Whether the assignment is active' })),
});

export type UpdateStudentAssignmentInput = Static<typeof UpdateStudentAssignmentSchema>;

// ─── Common Schemas ──────────────────────────────────────────────────────────

/**
 * Schema for ID path parameter.
 */
export const TransportParamsSchema = Type.Object({
  id: Type.String({
    pattern: UUID_PATTERN,
    description: 'Resource UUID',
  }),
});

export type TransportParams = Static<typeof TransportParamsSchema>;

/**
 * Schema for route ID path parameter (for nested resources).
 */
export const RouteParamsSchema = Type.Object({
  routeId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Transport route UUID',
  }),
});

export type RouteParams = Static<typeof RouteParamsSchema>;

/**
 * Schema for list query parameters.
 */
export const TransportListQuerySchema = Type.Object({
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  ),
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
  status: Type.Optional(Type.String({ description: 'Filter by status' })),
  search: Type.Optional(Type.String({ description: 'Search by name' })),
  sortBy: Type.Optional(Type.String({ default: 'createdAt', description: 'Sort field' })),
  sortOrder: Type.Optional(
    Type.String({ enum: ['asc', 'desc'], default: 'desc', description: 'Sort direction' }),
  ),
});

export type TransportListQuery = Static<typeof TransportListQuerySchema>;

// ─── Response Schemas ────────────────────────────────────────────────────────

export const TransportRouteResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  startLocation: Type.String(),
  endLocation: Type.String(),
  distanceKm: Type.Union([Type.Number(), Type.Null()]),
  estimatedDurationMinutes: Type.Union([Type.Number(), Type.Null()]),
  operatingDays: Type.Array(Type.String()),
  departureTime: Type.Union([Type.String(), Type.Null()]),
  returnTime: Type.Union([Type.String(), Type.Null()]),
  institutionId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type TransportRouteResponse = Static<typeof TransportRouteResponseSchema>;

export const RouteStopResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  routeId: Type.String(),
  name: Type.String(),
  latitude: Type.Union([Type.Number(), Type.Null()]),
  longitude: Type.Union([Type.Number(), Type.Null()]),
  stopOrder: Type.Number(),
  pickupTime: Type.Union([Type.String(), Type.Null()]),
  dropoffTime: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type RouteStopResponse = Static<typeof RouteStopResponseSchema>;

export const VehicleResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  registrationNumber: Type.String(),
  make: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  year: Type.Union([Type.Number(), Type.Null()]),
  capacity: Type.Number(),
  status: Type.String(),
  insuranceExpiry: Type.Union([Type.String(), Type.Null()]),
  lastServiceDate: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type VehicleResponse = Static<typeof VehicleResponseSchema>;

export const DriverAssignmentResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  vehicleId: Type.String(),
  driverId: Type.String(),
  routeId: Type.Union([Type.String(), Type.Null()]),
  startDate: Type.String(),
  endDate: Type.Union([Type.String(), Type.Null()]),
  isActive: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type DriverAssignmentResponse = Static<typeof DriverAssignmentResponseSchema>;

export const StudentAssignmentResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  studentId: Type.String(),
  routeId: Type.String(),
  stopId: Type.Union([Type.String(), Type.Null()]),
  startDate: Type.String(),
  endDate: Type.Union([Type.String(), Type.Null()]),
  isActive: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type StudentAssignmentResponse = Static<typeof StudentAssignmentResponseSchema>;

// ─── GPS / attendance-on-bus stub schemas (G-602) ────────────────────────────

export const RecordGpsPingSchema = Type.Object({
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
  recordedAt: Type.Optional(Type.String()),
  speedKph: Type.Optional(Type.Number({ minimum: 0 })),
  headingDeg: Type.Optional(Type.Number({ minimum: 0, maximum: 360 })),
});

export type RecordGpsPingInput = Static<typeof RecordGpsPingSchema>;

export const VehicleParamsSchema = Type.Object({
  vehicleId: Type.String({ pattern: UUID_PATTERN }),
});

export type VehicleParams = Static<typeof VehicleParamsSchema>;

export const RecordBusAttendanceSchema = Type.Object({
  vehicleId: Type.String({ pattern: UUID_PATTERN }),
  studentId: Type.String({ minLength: 1, maxLength: 128 }),
  eventType: Type.Union([Type.Literal('board'), Type.Literal('alight')]),
  routeId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  recordedAt: Type.Optional(Type.String()),
});

export type RecordBusAttendanceInput = Static<typeof RecordBusAttendanceSchema>;
