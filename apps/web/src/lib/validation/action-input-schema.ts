/**
 * BFF-side input schemas for thin server actions (PRC-L249).
 *
 * The gateway is the authoritative validator (schema + RBAC + tenant from the
 * verified JWT). These schemas are defence-in-depth: they reject malformed
 * ids/enums/sizes before an upstream call so users get a clear error.
 */
import { z } from 'zod';

export const actionUuid = z.string().uuid('Invalid id');

/** Same 50 MB cap the bulk-import panel enforces client-side. */
export const BULK_IMPORT_MAX_BYTES = 50 * 1024 * 1024;

export const BULK_IMPORT_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
] as const;

/** Decoded byte length of a base64 string without allocating a buffer. */
export function base64DecodedBytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

export const bulkImportInputSchema = z.object({
  fileBase64: z
    .string()
    .min(1, 'A file is required to start the import.')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'The file could not be read.')
    .refine((v) => base64DecodedBytes(v) <= BULK_IMPORT_MAX_BYTES, 'File exceeds the 50 MB limit.'),
  fileName: z.string().trim().min(1, 'A file is required to start the import.').max(255),
  mimeType: z.enum(BULK_IMPORT_MIME_TYPES, {
    message: 'Upload an Excel (.xlsx, .xls) or CSV file.',
  }),
  duplicateResolution: z.enum(['skip', 'update', 'create'], {
    message: 'Choose how duplicates are handled.',
  }),
  async: z.boolean().optional(),
});

export const bellScheduleInputSchema = z.object({
  institutionId: actionUuid,
  academicPeriodId: actionUuid,
  name: z.string().trim().min(1, 'Name is required').max(120),
  dayPattern: z.string().max(60).optional(),
});

const OPERATING_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const transportRouteInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().max(2000).optional(),
  startLocation: z.string().trim().min(1, 'Start location is required').max(255),
  endLocation: z.string().trim().min(1, 'End location is required').max(255),
  distanceKm: z.number().nonnegative().max(10000).optional(),
  estimatedDurationMinutes: z.number().int().nonnegative().max(1440).optional(),
  operatingDays: z.array(z.enum(OPERATING_DAYS)).min(1, 'Pick at least one operating day'),
  departureTime: hhmm.optional(),
  returnTime: hhmm.optional(),
});

export const transportVehicleInputSchema = z.object({
  registrationNumber: z.string().trim().min(1, 'Registration number is required').max(40),
  make: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  capacity: z.number().int().positive('Capacity must be positive').max(500),
});

export const driverAssignmentInputSchema = z.object({
  vehicleId: actionUuid,
  driverId: actionUuid,
  routeId: actionUuid.optional(),
  startDate: isoDate,
  endDate: isoDate.optional(),
});

export const workflowDefinitionInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  module: z.string().trim().min(1, 'Module is required').max(80),
  steps: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Step name is required').max(200),
        approverRole: z.string().trim().min(1, 'Approver role is required').max(80),
      }),
    )
    .min(1, 'Add at least one step')
    .max(20),
});

export const workflowDecisionSchema = z.object({
  approvalId: actionUuid,
  decision: z.enum(['approve', 'reject']),
});

export function firstIssueMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}
