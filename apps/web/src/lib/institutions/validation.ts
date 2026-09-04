/**
 * Zod schemas for institution-related forms.
 *
 * Mirror the Typebox schemas defined in
 * `packages/backend/institution/src/schemas.ts`.
 */
import { z } from 'zod';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const uuid = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .regex(UUID_PATTERN, `${label} must be a valid UUID`);

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .or(z.literal(''))
    .transform((value) => (value === '' || value === undefined ? undefined : value));

const optionalCoordinate = (min: number, max: number, label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .or(z.literal(''))
    .transform((value) => {
      if (value === undefined || value === null || value === '') return undefined;
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) return Number.NaN;
      return num;
    })
    .refine(
      (value) => value === undefined || (!Number.isNaN(value) && value >= min && value <= max),
      `${label} must be between ${min} and ${max}`
    );

export const institutionFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be 255 characters or fewer'),
  code: z
    .string()
    .min(1, 'Code is required')
    .max(50, 'Code must be 50 characters or fewer'),
  areaId: uuid('Area'),
  typeId: uuid('Type'),
  sectorId: uuid('Sector'),
  ownershipId: uuid('Ownership'),
  address: optionalString(500),
  contactPhone: optionalString(50),
  contactEmail: z
    .string()
    .max(254)
    .email('Must be a valid email')
    .optional()
    .or(z.literal(''))
    .transform((value) => (value === '' || value === undefined ? undefined : value)),
  latitude: optionalCoordinate(-90, 90, 'Latitude'),
  longitude: optionalCoordinate(-180, 180, 'Longitude'),
});

export type InstitutionFormValues = z.input<typeof institutionFormSchema>;
export type InstitutionFormParsed = z.output<typeof institutionFormSchema>;

export const academicPeriodFormSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Name is required')
      .max(100, 'Name must be 100 characters or fewer'),
    code: z
      .string()
      .min(1, 'Code is required')
      .max(50, 'Code must be 50 characters or fewer'),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format'),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format'),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export type AcademicPeriodFormValues = z.input<typeof academicPeriodFormSchema>;
export type AcademicPeriodFormParsed = z.output<typeof academicPeriodFormSchema>;

export const gradeFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer'),
  code: z
    .string()
    .min(1, 'Code is required')
    .max(50, 'Code must be 50 characters or fewer'),
  order: z.coerce.number().int().min(0).max(32767),
});

export type GradeFormValues = z.input<typeof gradeFormSchema>;

export const classSectionFormSchema = z.object({
  institutionId: uuid('Institution'),
  gradeId: uuid('Grade'),
  academicPeriodId: uuid('Academic period'),
  name: z
    .string()
    .min(1, 'Section name is required')
    .max(100, 'Name must be 100 characters or fewer'),
  capacity: z
    .union([z.string(), z.number()])
    .optional()
    .or(z.literal(''))
    .transform((value) => {
      if (value === undefined || value === null || value === '') return undefined;
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? num : Number.NaN;
    })
    .refine(
      (value) => value === undefined || (!Number.isNaN(value) && value >= 1 && value <= 32767),
      'Capacity must be between 1 and 32767',
    ),
});

export type ClassSectionFormValues = z.input<typeof classSectionFormSchema>;
export type ClassSectionFormParsed = z.output<typeof classSectionFormSchema>;
