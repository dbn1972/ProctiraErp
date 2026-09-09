/**
 * Zod schemas for the staff create / edit / assignment / appraisal forms.
 *
 * Mirrors the Typebox schemas in `@proctira/backend-staff`.
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

const uuid = z.string().uuid('Must be a valid UUID');

export const staffFormSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  dateOfBirth: isoDate,
  identityNumber: z
    .string()
    .min(1, 'Identity number is required')
    .max(50, 'Identity number is too long'),
  contactPhone: z.string().min(1, 'Contact phone is required').max(50, 'Contact phone is too long'),
  contactEmail: z.string().max(254).email('Invalid email address').or(z.literal('')),
  position: z.string().min(1, 'Position is required').max(100),
});

export type StaffFormValues = z.infer<typeof staffFormSchema>;

export const assignmentFormSchema = z
  .object({
    institutionId: uuid,
    subjectId: uuid,
    classId: uuid,
    role: z.string().min(1, 'Role is required').max(100),
    allocationPercentage: z
      .number({ message: 'Allocation percentage is required' })
      .min(1, 'Allocation must be at least 1%')
      .max(100, 'Allocation cannot exceed 100%'),
    startDate: isoDate,
    endDate: isoDateOptional,
  })
  .refine((data) => !data.endDate || data.endDate === '' || data.endDate >= data.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export type AssignmentFormValues = z.infer<typeof assignmentFormSchema>;

export const appraisalScoreSchema = z.object({
  criterionName: z.string().min(1),
  score: z.number({ message: 'Score is required' }).min(0),
  comment: z.string().max(500).optional().or(z.literal('')),
});

export const appraisalFormSchema = z.object({
  templateId: uuid,
  appraisalDate: isoDate,
  scores: z.array(appraisalScoreSchema).min(1, 'At least one score is required'),
  overallComment: z.string().max(1000).optional().or(z.literal('')),
});

export type AppraisalFormValues = z.infer<typeof appraisalFormSchema>;

export const contractFormSchema = z.object({
  staffId: uuid,
  contractType: z.enum(['permanent', 'probation', 'fixed_term', 'visiting', 'intern']),
  startDate: isoDate,
  endDate: isoDateOptional,
  salaryBand: z.string().max(64).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});
export type ContractFormValues = z.infer<typeof contractFormSchema>;

export const qualificationFormSchema = z.object({
  staffId: uuid,
  degree: z.string().min(1).max(200),
  institution: z.string().min(1).max(200),
  year: z.number().int().min(1950).max(2100),
  documentRef: z.string().max(512).optional().or(z.literal('')),
});
export type QualificationFormValues = z.infer<typeof qualificationFormSchema>;

export const staffImportSchema = z.object({
  csv: z.string().min(1, 'CSV is required').max(1_000_000),
  filename: z.string().max(255).optional(),
});


