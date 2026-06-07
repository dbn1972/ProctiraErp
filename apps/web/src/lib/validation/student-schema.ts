/**
 * Zod schemas for the student create / edit form.
 *
 * Mirrors the Typebox schema in `@proctira/backend-student`:
 *   - Requirement 6.1: name and date of birth are mandatory
 *   - Requirement 6.5: customData is open-ended
 *
 * Note: `.default()` is intentionally avoided so that the schema's input and
 * output types match. The form always provides full shapes through its
 * `defaultValues`.
 */
import { z } from 'zod';

const isoDate = z
  .string()
  .min(1, 'Date is required')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD date format');

const isoDateOptional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD date format')
  .or(z.literal(''));

export const contactSchema = z.object({
  type: z.string().min(1, 'Contact type is required').max(50),
  value: z.string().min(1, 'Contact value is required').max(255),
  isPrimary: z.boolean(),
});

export const guardianSchema = z.object({
  id: z.string().optional(),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  relationship: z.string().min(1, 'Relationship is required').max(50),
  contactPhone: z.string().max(50).or(z.literal('')),
  contactEmail: z
    .string()
    .max(254)
    .email('Invalid email address')
    .or(z.literal('')),
});

export const identityDocumentSchema = z.object({
  type: z.string().min(1, 'Document type is required').max(50),
  number: z.string().min(1, 'Document number is required').max(100),
  issuingCountry: z.string().max(100).or(z.literal('')),
  expiryDate: isoDateOptional,
});

export const studentFormSchema = z.object({
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(100, 'First name is too long'),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(100, 'Last name is too long'),
  dateOfBirth: isoDate,
  gender: z.string().min(1, 'Gender is required').max(20),
  nationalId: z.string().max(50).or(z.literal('')),
  nationality: z.string().max(100).or(z.literal('')),
  contacts: z.array(contactSchema),
  guardians: z.array(guardianSchema),
  identityDocuments: z.array(identityDocumentSchema),
  customData: z.record(z.string(), z.unknown()),
});

export type StudentFormValues = z.infer<typeof studentFormSchema>;

export const transferFormSchema = z.object({
  sourceEnrollmentId: z.string().min(1, 'Source enrollment is required'),
  destinationInstitutionId: z
    .string()
    .min(1, 'Destination institution is required'),
  destinationGradeId: z.string().min(1, 'Grade is required'),
  destinationClassId: z.string().or(z.literal('')),
  academicPeriodId: z.string().min(1, 'Academic period is required'),
  transferDate: isoDate,
  reason: z
    .string()
    .min(1, 'Reason is required')
    .max(500, 'Reason cannot exceed 500 characters'),
});

export type TransferFormValues = z.infer<typeof transferFormSchema>;
