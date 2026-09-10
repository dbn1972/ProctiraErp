/**
 * Typebox schemas for Health Service request/response validation.
 *
 * Defines schemas for:
 * - Health measurements (height, weight, BMI, blood pressure, etc.)
 * - Allergies
 * - Health conditions
 * - Vaccinations
 * - Insurance
 * - Special needs assessments, diagnoses, referrals, accommodation plans
 * - Counselling sessions with case notes and follow-ups
 * - Health screening programs
 *
 * Requirements:
 * - 12.1: Record student health data including body measurements, allergies, conditions, vaccinations, insurance
 * - 12.2: Track special needs assessments, diagnoses, referrals, and accommodation plans
 * - 12.3: Manage counselling sessions with case notes, follow-ups, and outcome tracking
 * - 12.4: Restrict access to authorized health personnel and student's guardian
 * - 12.5: Support configurable health screening programs with scheduled assessments per grade level
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── Common Schemas ───────────────────────────────────────────────────────────

export const UuidParamsSchema = Type.Object({
  id: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'UUID',
  }),
});
export type UuidParams = Static<typeof UuidParamsSchema>;

export const StudentParamsSchema = Type.Object({
  studentId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Student UUID',
  }),
});
export type StudentParams = Static<typeof StudentParamsSchema>;

export const PaginationQuerySchema = Type.Object({
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  ),
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
});
export type PaginationQuery = Static<typeof PaginationQuerySchema>;

// ─── Health Measurement Schemas ───────────────────────────────────────────────

export const CreateMeasurementSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  date: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Measurement date (YYYY-MM-DD)',
  }),
  height: Type.Optional(Type.Number({ minimum: 0, description: 'Height in cm' })),
  weight: Type.Optional(Type.Number({ minimum: 0, description: 'Weight in kg' })),
  bmi: Type.Optional(Type.Number({ minimum: 0, description: 'Body Mass Index' })),
  bloodPressureSystolic: Type.Optional(
    Type.Number({ minimum: 0, description: 'Systolic blood pressure (mmHg)' }),
  ),
  bloodPressureDiastolic: Type.Optional(
    Type.Number({ minimum: 0, description: 'Diastolic blood pressure (mmHg)' }),
  ),
  heartRate: Type.Optional(Type.Number({ minimum: 0, description: 'Heart rate (bpm)' })),
  visionLeft: Type.Optional(
    Type.String({ maxLength: 20, description: 'Left eye vision (e.g., 20/20)' }),
  ),
  visionRight: Type.Optional(
    Type.String({ maxLength: 20, description: 'Right eye vision (e.g., 20/20)' }),
  ),
  notes: Type.Optional(Type.String({ maxLength: 1000, description: 'Additional notes' })),
});
export type CreateMeasurementInput = Static<typeof CreateMeasurementSchema>;

export const UpdateMeasurementSchema = Type.Object({
  date: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Measurement date' }),
  ),
  height: Type.Optional(Type.Number({ minimum: 0, description: 'Height in cm' })),
  weight: Type.Optional(Type.Number({ minimum: 0, description: 'Weight in kg' })),
  bmi: Type.Optional(Type.Number({ minimum: 0, description: 'Body Mass Index' })),
  bloodPressureSystolic: Type.Optional(
    Type.Number({ minimum: 0, description: 'Systolic blood pressure' }),
  ),
  bloodPressureDiastolic: Type.Optional(
    Type.Number({ minimum: 0, description: 'Diastolic blood pressure' }),
  ),
  heartRate: Type.Optional(Type.Number({ minimum: 0, description: 'Heart rate' })),
  visionLeft: Type.Optional(Type.String({ maxLength: 20, description: 'Left eye vision' })),
  visionRight: Type.Optional(Type.String({ maxLength: 20, description: 'Right eye vision' })),
  notes: Type.Optional(Type.String({ maxLength: 1000, description: 'Additional notes' })),
});
export type UpdateMeasurementInput = Static<typeof UpdateMeasurementSchema>;

// ─── Allergy Schemas ──────────────────────────────────────────────────────────

export const CreateAllergySchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  allergyType: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Type of allergy (e.g., food, drug, environmental)',
  }),
  description: Type.String({ minLength: 1, maxLength: 500, description: 'Allergy description' }),
  severity: Type.String({
    enum: ['mild', 'moderate', 'severe', 'life-threatening'],
    description: 'Severity level',
  }),
  reaction: Type.Optional(Type.String({ maxLength: 500, description: 'Typical reaction' })),
  treatment: Type.Optional(
    Type.String({ maxLength: 500, description: 'Treatment/management plan' }),
  ),
  diagnosedDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date diagnosed' }),
  ),
});
export type CreateAllergyInput = Static<typeof CreateAllergySchema>;

export const UpdateAllergySchema = Type.Object({
  allergyType: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  severity: Type.Optional(
    Type.String({ enum: ['mild', 'moderate', 'severe', 'life-threatening'] }),
  ),
  reaction: Type.Optional(Type.String({ maxLength: 500 })),
  treatment: Type.Optional(Type.String({ maxLength: 500 })),
  diagnosedDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
});
export type UpdateAllergyInput = Static<typeof UpdateAllergySchema>;

// ─── Health Condition Schemas ─────────────────────────────────────────────────

export const CreateConditionSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  conditionName: Type.String({
    minLength: 1,
    maxLength: 200,
    description: 'Name of the condition',
  }),
  conditionType: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Type/category of condition',
  }),
  diagnosedDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Date diagnosed' }),
  ),
  status: Type.String({ enum: ['active', 'managed', 'resolved'], description: 'Current status' }),
  treatment: Type.Optional(Type.String({ maxLength: 1000, description: 'Treatment plan' })),
  medication: Type.Optional(Type.String({ maxLength: 500, description: 'Current medication' })),
  notes: Type.Optional(Type.String({ maxLength: 1000, description: 'Additional notes' })),
});
export type CreateConditionInput = Static<typeof CreateConditionSchema>;

export const UpdateConditionSchema = Type.Object({
  conditionName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  conditionType: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  diagnosedDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  status: Type.Optional(Type.String({ enum: ['active', 'managed', 'resolved'] })),
  treatment: Type.Optional(Type.String({ maxLength: 1000 })),
  medication: Type.Optional(Type.String({ maxLength: 500 })),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});
export type UpdateConditionInput = Static<typeof UpdateConditionSchema>;

// ─── Vaccination Schemas ──────────────────────────────────────────────────────

export const CreateVaccinationSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  vaccineName: Type.String({ minLength: 1, maxLength: 200, description: 'Name of the vaccine' }),
  doseNumber: Type.Number({ minimum: 1, description: 'Dose number (e.g., 1, 2, 3)' }),
  dateAdministered: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Date administered',
  }),
  administeredBy: Type.Optional(
    Type.String({ maxLength: 200, description: 'Administered by (name/facility)' }),
  ),
  batchNumber: Type.Optional(Type.String({ maxLength: 100, description: 'Vaccine batch number' })),
  nextDueDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Next dose due date' }),
  ),
  notes: Type.Optional(Type.String({ maxLength: 500, description: 'Additional notes' })),
});
export type CreateVaccinationInput = Static<typeof CreateVaccinationSchema>;

export const UpdateVaccinationSchema = Type.Object({
  vaccineName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  doseNumber: Type.Optional(Type.Number({ minimum: 1 })),
  dateAdministered: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  administeredBy: Type.Optional(Type.String({ maxLength: 200 })),
  batchNumber: Type.Optional(Type.String({ maxLength: 100 })),
  nextDueDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  notes: Type.Optional(Type.String({ maxLength: 500 })),
});
export type UpdateVaccinationInput = Static<typeof UpdateVaccinationSchema>;

// ─── Insurance Schemas ────────────────────────────────────────────────────────

export const CreateInsuranceSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  provider: Type.String({ minLength: 1, maxLength: 200, description: 'Insurance provider name' }),
  policyNumber: Type.String({ minLength: 1, maxLength: 100, description: 'Policy number' }),
  coverageType: Type.String({ minLength: 1, maxLength: 100, description: 'Type of coverage' }),
  startDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Coverage start date' }),
  endDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Coverage end date' }),
  ),
  notes: Type.Optional(Type.String({ maxLength: 500, description: 'Additional notes' })),
});
export type CreateInsuranceInput = Static<typeof CreateInsuranceSchema>;

export const UpdateInsuranceSchema = Type.Object({
  provider: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  policyNumber: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  coverageType: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  startDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  endDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  notes: Type.Optional(Type.String({ maxLength: 500 })),
});
export type UpdateInsuranceInput = Static<typeof UpdateInsuranceSchema>;

// ─── Special Needs Assessment Schemas ─────────────────────────────────────────

export const CreateSpecialNeedsAssessmentSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  assessmentDate: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Assessment date',
  }),
  assessorName: Type.String({ minLength: 1, maxLength: 200, description: 'Name of assessor' }),
  assessorRole: Type.String({ minLength: 1, maxLength: 100, description: 'Role of assessor' }),
  assessmentType: Type.String({ minLength: 1, maxLength: 100, description: 'Type of assessment' }),
  findings: Type.String({ minLength: 1, maxLength: 2000, description: 'Assessment findings' }),
  recommendations: Type.Optional(Type.String({ maxLength: 2000, description: 'Recommendations' })),
});
export type CreateSpecialNeedsAssessmentInput = Static<typeof CreateSpecialNeedsAssessmentSchema>;

// ─── Diagnosis Schemas ────────────────────────────────────────────────────────

export const CreateDiagnosisSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  assessmentId: Type.Optional(Type.String({ description: 'Related assessment UUID' })),
  diagnosisDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Diagnosis date' }),
  diagnosedBy: Type.String({ minLength: 1, maxLength: 200, description: 'Diagnosed by' }),
  condition: Type.String({ minLength: 1, maxLength: 200, description: 'Diagnosed condition' }),
  category: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Diagnosis category (e.g., learning, physical, sensory)',
  }),
  severity: Type.String({ enum: ['mild', 'moderate', 'severe'], description: 'Severity level' }),
  notes: Type.Optional(Type.String({ maxLength: 1000, description: 'Additional notes' })),
});
export type CreateDiagnosisInput = Static<typeof CreateDiagnosisSchema>;

// ─── Referral Schemas ─────────────────────────────────────────────────────────

export const CreateReferralSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  diagnosisId: Type.Optional(Type.String({ description: 'Related diagnosis UUID' })),
  referralDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Referral date' }),
  referredBy: Type.String({ minLength: 1, maxLength: 200, description: 'Referred by' }),
  referredTo: Type.String({
    minLength: 1,
    maxLength: 200,
    description: 'Referred to (specialist/facility)',
  }),
  reason: Type.String({ minLength: 1, maxLength: 500, description: 'Reason for referral' }),
  status: Type.String({
    enum: ['pending', 'scheduled', 'completed', 'cancelled'],
    description: 'Referral status',
  }),
  appointmentDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Appointment date' }),
  ),
  outcome: Type.Optional(Type.String({ maxLength: 1000, description: 'Referral outcome' })),
});
export type CreateReferralInput = Static<typeof CreateReferralSchema>;

export const UpdateReferralSchema = Type.Object({
  status: Type.Optional(Type.String({ enum: ['pending', 'scheduled', 'completed', 'cancelled'] })),
  appointmentDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  outcome: Type.Optional(Type.String({ maxLength: 1000 })),
});
export type UpdateReferralInput = Static<typeof UpdateReferralSchema>;

// ─── Accommodation Plan Schemas ───────────────────────────────────────────────

export const CreateAccommodationPlanSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  diagnosisId: Type.Optional(Type.String({ description: 'Related diagnosis UUID' })),
  planName: Type.String({ minLength: 1, maxLength: 200, description: 'Plan name/title' }),
  startDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Plan start date' }),
  endDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Plan end date' }),
  ),
  accommodations: Type.Array(
    Type.Object({
      type: Type.String({ minLength: 1, maxLength: 100, description: 'Accommodation type' }),
      description: Type.String({
        minLength: 1,
        maxLength: 500,
        description: 'Accommodation description',
      }),
    }),
    { minItems: 1, description: 'List of accommodations' },
  ),
  reviewDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Next review date' }),
  ),
  status: Type.String({
    enum: ['active', 'under-review', 'expired', 'cancelled'],
    description: 'Plan status',
  }),
  notes: Type.Optional(Type.String({ maxLength: 1000, description: 'Additional notes' })),
});
export type CreateAccommodationPlanInput = Static<typeof CreateAccommodationPlanSchema>;

export const UpdateAccommodationPlanSchema = Type.Object({
  planName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  startDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  endDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  accommodations: Type.Optional(
    Type.Array(
      Type.Object({
        type: Type.String({ minLength: 1, maxLength: 100 }),
        description: Type.String({ minLength: 1, maxLength: 500 }),
      }),
      { minItems: 1 },
    ),
  ),
  reviewDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  status: Type.Optional(Type.String({ enum: ['active', 'under-review', 'expired', 'cancelled'] })),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});
export type UpdateAccommodationPlanInput = Static<typeof UpdateAccommodationPlanSchema>;

// ─── Counselling Session Schemas ──────────────────────────────────────────────

export const CreateCounsellingSessionSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  counsellorId: Type.String({ description: 'Counsellor (staff) UUID' }),
  sessionDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Session date' }),
  sessionType: Type.String({
    enum: ['individual', 'group', 'family', 'crisis'],
    description: 'Session type',
  }),
  reason: Type.String({ minLength: 1, maxLength: 500, description: 'Reason for session' }),
  caseNotes: Type.String({ minLength: 1, maxLength: 5000, description: 'Case notes' }),
  outcome: Type.Optional(Type.String({ maxLength: 1000, description: 'Session outcome' })),
  followUpRequired: Type.Boolean({ default: false, description: 'Whether follow-up is required' }),
  followUpDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Follow-up date' }),
  ),
  status: Type.String({
    enum: ['scheduled', 'completed', 'cancelled', 'no-show'],
    description: 'Session status',
  }),
});
export type CreateCounsellingSessionInput = Static<typeof CreateCounsellingSessionSchema>;

export const UpdateCounsellingSessionSchema = Type.Object({
  sessionDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  sessionType: Type.Optional(Type.String({ enum: ['individual', 'group', 'family', 'crisis'] })),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  caseNotes: Type.Optional(Type.String({ minLength: 1, maxLength: 5000 })),
  outcome: Type.Optional(Type.String({ maxLength: 1000 })),
  followUpRequired: Type.Optional(Type.Boolean()),
  followUpDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  status: Type.Optional(Type.String({ enum: ['scheduled', 'completed', 'cancelled', 'no-show'] })),
});
export type UpdateCounsellingSessionInput = Static<typeof UpdateCounsellingSessionSchema>;

// ─── Health Screening Program Schemas ─────────────────────────────────────────

export const CreateScreeningProgramSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200, description: 'Program name' }),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Program description' })),
  gradeLevel: Type.String({ minLength: 1, maxLength: 50, description: 'Target grade level' }),
  academicPeriodId: Type.String({ description: 'Academic period UUID' }),
  assessmentTypes: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
    minItems: 1,
    description: 'Types of assessments included (e.g., vision, hearing, dental)',
  }),
  scheduledDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Scheduled date' }),
  ),
  status: Type.String({
    enum: ['planned', 'in-progress', 'completed', 'cancelled'],
    description: 'Program status',
  }),
});
export type CreateScreeningProgramInput = Static<typeof CreateScreeningProgramSchema>;

export const UpdateScreeningProgramSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  gradeLevel: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  academicPeriodId: Type.Optional(Type.String()),
  assessmentTypes: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { minItems: 1 }),
  ),
  scheduledDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  status: Type.Optional(
    Type.String({ enum: ['planned', 'in-progress', 'completed', 'cancelled'] }),
  ),
});
export type UpdateScreeningProgramInput = Static<typeof UpdateScreeningProgramSchema>;
