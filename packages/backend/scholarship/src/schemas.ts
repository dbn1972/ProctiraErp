/**
 * Typebox schemas for Scholarship Service request/response validation.
 *
 * Defines schemas for:
 * - Scholarship Program CRUD (eligibility, periods, slots)
 * - Application submission (documents, academic records, financial info)
 * - Disbursement tracking (schedules, payments, compliance)
 * - Utilization reports (by program, area, gender, institution)
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── UUID Pattern ────────────────────────────────────────────────────────────

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Scholarship Program Schemas ─────────────────────────────────────────────

/**
 * Eligibility criteria for a scholarship program.
 */
export const EligibilityCriteriaSchema = Type.Object({
  minGPA: Type.Optional(
    Type.Number({ minimum: 0, maximum: 4.0, description: 'Minimum GPA required' }),
  ),
  maxAge: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, description: 'Maximum age of applicant' }),
  ),
  genders: Type.Optional(
    Type.Array(Type.String({ enum: ['male', 'female', 'other'] }), {
      description: 'Eligible genders',
    }),
  ),
  areaIds: Type.Optional(
    Type.Array(Type.String({ pattern: UUID_PATTERN }), { description: 'Eligible area IDs' }),
  ),
  institutionIds: Type.Optional(
    Type.Array(Type.String({ pattern: UUID_PATTERN }), { description: 'Eligible institution IDs' }),
  ),
  educationLevels: Type.Optional(
    Type.Array(Type.String(), { description: 'Eligible education levels' }),
  ),
  maxFamilyIncome: Type.Optional(
    Type.Number({ minimum: 0, description: 'Maximum family income threshold' }),
  ),
  requiredDocuments: Type.Optional(
    Type.Array(Type.String(), { description: 'Required document types for application' }),
  ),
  customCriteria: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: 'Additional custom eligibility criteria',
    }),
  ),
});

export type EligibilityCriteria = Static<typeof EligibilityCriteriaSchema>;

/**
 * Schema for creating a new scholarship program.
 * Requirement 11.1: Define scholarship programs with eligibility criteria, application periods, and available slots.
 */
export const CreateScholarshipProgramSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Program name' }),
  description: Type.Optional(Type.String({ maxLength: 2000, description: 'Program description' })),
  applicationStartDate: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Application period start date (ISO date YYYY-MM-DD)',
  }),
  applicationEndDate: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Application period end date (ISO date YYYY-MM-DD)',
  }),
  totalSlots: Type.Number({
    minimum: 1,
    maximum: 100000,
    description: 'Total available scholarship slots',
  }),
  amountPerRecipient: Type.Number({ minimum: 0, description: 'Scholarship amount per recipient' }),
  currency: Type.Optional(
    Type.String({ minLength: 3, maxLength: 3, description: 'Currency code (ISO 4217)' }),
  ),
  disbursementFrequency: Type.Optional(
    Type.String({
      enum: ['one_time', 'monthly', 'quarterly', 'semester', 'annual'],
      description: 'Disbursement frequency',
    }),
  ),
  eligibility: EligibilityCriteriaSchema,
  academicPeriodId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  ),
  fundingSourceId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Funding source UUID' }),
  ),
});

export type CreateScholarshipProgramInput = Static<typeof CreateScholarshipProgramSchema>;

/**
 * Schema for updating a scholarship program.
 */
export const UpdateScholarshipProgramSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Program name' })),
  description: Type.Optional(Type.String({ maxLength: 2000, description: 'Program description' })),
  applicationStartDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Application period start date',
    }),
  ),
  applicationEndDate: Type.Optional(
    Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Application period end date' }),
  ),
  totalSlots: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100000, description: 'Total available slots' }),
  ),
  amountPerRecipient: Type.Optional(
    Type.Number({ minimum: 0, description: 'Amount per recipient' }),
  ),
  currency: Type.Optional(
    Type.String({ minLength: 3, maxLength: 3, description: 'Currency code' }),
  ),
  disbursementFrequency: Type.Optional(
    Type.String({
      enum: ['one_time', 'monthly', 'quarterly', 'semester', 'annual'],
      description: 'Disbursement frequency',
    }),
  ),
  eligibility: Type.Optional(EligibilityCriteriaSchema),
  status: Type.Optional(
    Type.String({ enum: ['draft', 'open', 'closed', 'archived'], description: 'Program status' }),
  ),
  academicPeriodId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  ),
  fundingSourceId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Funding source UUID' }),
  ),
});

export type UpdateScholarshipProgramInput = Static<typeof UpdateScholarshipProgramSchema>;

// ─── Application Schemas ─────────────────────────────────────────────────────

/**
 * Academic record attached to an application.
 */
export const AcademicRecordSchema = Type.Object({
  institutionName: Type.String({ minLength: 1, maxLength: 255, description: 'Institution name' }),
  educationLevel: Type.String({ minLength: 1, maxLength: 100, description: 'Education level' }),
  gpa: Type.Optional(Type.Number({ minimum: 0, maximum: 4.0, description: 'GPA' })),
  yearCompleted: Type.Optional(
    Type.Number({ minimum: 1900, maximum: 2100, description: 'Year completed' }),
  ),
  fieldOfStudy: Type.Optional(Type.String({ maxLength: 255, description: 'Field of study' })),
});

export type AcademicRecord = Static<typeof AcademicRecordSchema>;

/**
 * Financial information attached to an application.
 */
export const FinancialInfoSchema = Type.Object({
  familyIncome: Type.Optional(Type.Number({ minimum: 0, description: 'Annual family income' })),
  numberOfDependents: Type.Optional(
    Type.Number({ minimum: 0, maximum: 50, description: 'Number of dependents' }),
  ),
  employmentStatus: Type.Optional(
    Type.String({
      enum: ['employed', 'unemployed', 'self_employed', 'student'],
      description: 'Employment status',
    }),
  ),
  otherScholarships: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String({ description: 'Scholarship name' }),
        amount: Type.Number({ minimum: 0, description: 'Amount received' }),
      }),
      { description: 'Other scholarships received' },
    ),
  ),
});

export type FinancialInfo = Static<typeof FinancialInfoSchema>;

/**
 * Document attached to an application.
 */
export const ApplicationDocumentSchema = Type.Object({
  documentType: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Document type (e.g., transcript, ID, recommendation)',
  }),
  fileName: Type.String({ minLength: 1, maxLength: 255, description: 'Original file name' }),
  fileUrl: Type.String({ minLength: 1, description: 'Storage URL for the document' }),
  fileSize: Type.Optional(Type.Number({ minimum: 0, description: 'File size in bytes' })),
});

export type ApplicationDocument = Static<typeof ApplicationDocumentSchema>;

/**
 * Schema for submitting a scholarship application.
 * Requirement 11.2: Accept and track applications with required documents, academic records, and financial information.
 */
export const CreateApplicationSchema = Type.Object({
  programId: Type.String({ pattern: UUID_PATTERN, description: 'Scholarship program UUID' }),
  applicantId: Type.String({ pattern: UUID_PATTERN, description: 'Applicant (student) UUID' }),
  institutionId: Type.String({ pattern: UUID_PATTERN, description: 'Current institution UUID' }),
  academicRecords: Type.Array(AcademicRecordSchema, {
    minItems: 1,
    description: 'Academic records',
  }),
  financialInfo: FinancialInfoSchema,
  documents: Type.Array(ApplicationDocumentSchema, { description: 'Supporting documents' }),
  personalStatement: Type.Optional(
    Type.String({ maxLength: 5000, description: 'Personal statement' }),
  ),
  areaId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Applicant area UUID' })),
  gender: Type.Optional(
    Type.String({ enum: ['male', 'female', 'other'], description: 'Applicant gender' }),
  ),
});

export type CreateApplicationInput = Static<typeof CreateApplicationSchema>;

/**
 * Optional body for POST …/applications/:id/approve | reject (G-911).
 * The reviewer is taken from the JWT, never from the body.
 */
export const ApplicationDecisionSchema = Type.Object({
  comment: Type.Optional(
    Type.String({ maxLength: 2000, description: 'Reviewer note visible to the school' }),
  ),
  scheduleFirstDisbursement: Type.Optional(
    Type.Boolean({
      description: 'Approve only — queue the first instalment today (default true)',
    }),
  ),
});

export type ApplicationDecisionInput = Static<typeof ApplicationDecisionSchema>;

// ─── Disbursement Schemas ────────────────────────────────────────────────────

/**
 * Schema for creating a disbursement record.
 * Requirement 11.4: Track disbursement schedules, payment status, and recipient compliance.
 */
export const CreateDisbursementSchema = Type.Object({
  applicationId: Type.String({ pattern: UUID_PATTERN, description: 'Approved application UUID' }),
  amount: Type.Number({ minimum: 0, description: 'Disbursement amount' }),
  scheduledDate: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Scheduled payment date (YYYY-MM-DD)',
  }),
  paymentMethod: Type.Optional(
    Type.String({
      enum: ['bank_transfer', 'check', 'cash', 'mobile_money'],
      description: 'Payment method',
    }),
  ),
  notes: Type.Optional(Type.String({ maxLength: 1000, description: 'Disbursement notes' })),
});

export type CreateDisbursementInput = Static<typeof CreateDisbursementSchema>;

/**
 * Schema for updating disbursement status.
 */
export const UpdateDisbursementSchema = Type.Object({
  paymentStatus: Type.String({
    enum: ['scheduled', 'processing', 'paid', 'failed', 'cancelled'],
    description: 'Payment status',
  }),
  paidDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Actual payment date (YYYY-MM-DD)',
    }),
  ),
  transactionReference: Type.Optional(
    Type.String({ maxLength: 255, description: 'Payment transaction reference' }),
  ),
  notes: Type.Optional(Type.String({ maxLength: 1000, description: 'Status update notes' })),
});

export type UpdateDisbursementInput = Static<typeof UpdateDisbursementSchema>;

/**
 * Schema for recording recipient compliance.
 */
export const RecipientComplianceSchema = Type.Object({
  applicationId: Type.String({ pattern: UUID_PATTERN, description: 'Application UUID' }),
  complianceType: Type.String({
    enum: ['academic_performance', 'attendance', 'community_service', 'report_submission'],
    description: 'Type of compliance check',
  }),
  status: Type.String({
    enum: ['compliant', 'non_compliant', 'pending_review'],
    description: 'Compliance status',
  }),
  evaluationDate: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Evaluation date (YYYY-MM-DD)',
  }),
  details: Type.Optional(Type.String({ maxLength: 2000, description: 'Compliance details' })),
  evaluatorId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Evaluator user UUID' }),
  ),
});

export type RecipientComplianceInput = Static<typeof RecipientComplianceSchema>;

// ─── Report Schemas ──────────────────────────────────────────────────────────

/**
 * Schema for utilization report query parameters.
 * Requirement 11.5: Generate reports on scholarship utilization by program, area, gender, and institution.
 */
export const UtilizationReportQuerySchema = Type.Object({
  programId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Filter by program' }),
  ),
  areaId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Filter by area' })),
  gender: Type.Optional(
    Type.String({ enum: ['male', 'female', 'other'], description: 'Filter by gender' }),
  ),
  institutionId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Filter by institution' }),
  ),
  startDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Report period start date (YYYY-MM-DD)',
    }),
  ),
  endDate: Type.Optional(
    Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Report period end date (YYYY-MM-DD)',
    }),
  ),
  groupBy: Type.Optional(
    Type.String({
      enum: ['program', 'area', 'gender', 'institution'],
      description: 'Group results by dimension',
    }),
  ),
});

export type UtilizationReportQuery = Static<typeof UtilizationReportQuerySchema>;

// ─── Common Schemas ──────────────────────────────────────────────────────────

/**
 * Schema for ID path parameter.
 */
export const ScholarshipParamsSchema = Type.Object({
  id: Type.String({
    pattern: UUID_PATTERN,
    description: 'Resource UUID',
  }),
});

export type ScholarshipParams = Static<typeof ScholarshipParamsSchema>;

/**
 * Schema for list query parameters.
 */
export const ScholarshipListQuerySchema = Type.Object({
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

export type ScholarshipListQuery = Static<typeof ScholarshipListQuerySchema>;

// ─── Response Schemas ────────────────────────────────────────────────────────

export const ScholarshipProgramResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  applicationStartDate: Type.String(),
  applicationEndDate: Type.String(),
  totalSlots: Type.Number(),
  usedSlots: Type.Number(),
  amountPerRecipient: Type.Number(),
  currency: Type.String(),
  disbursementFrequency: Type.String(),
  eligibility: EligibilityCriteriaSchema,
  status: Type.String(),
  academicPeriodId: Type.Union([Type.String(), Type.Null()]),
  fundingSourceId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type ScholarshipProgramResponse = Static<typeof ScholarshipProgramResponseSchema>;

export const ApplicationResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  programId: Type.String(),
  applicantId: Type.String(),
  institutionId: Type.String(),
  status: Type.String(),
  academicRecords: Type.Array(AcademicRecordSchema),
  financialInfo: FinancialInfoSchema,
  documents: Type.Array(ApplicationDocumentSchema),
  personalStatement: Type.Union([Type.String(), Type.Null()]),
  areaId: Type.Union([Type.String(), Type.Null()]),
  gender: Type.Union([Type.String(), Type.Null()]),
  workflowInstanceId: Type.Union([Type.String(), Type.Null()]),
  submittedAt: Type.String(),
  reviewedAt: Type.Union([Type.String(), Type.Null()]),
  reviewerId: Type.Union([Type.String(), Type.Null()]),
  reviewNotes: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type ApplicationResponse = Static<typeof ApplicationResponseSchema>;

export const DisbursementResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  applicationId: Type.String(),
  amount: Type.Number(),
  amountCents: Type.Integer({ minimum: 0 }),
  scheduledDate: Type.String(),
  paidDate: Type.Union([Type.String(), Type.Null()]),
  paymentStatus: Type.String(),
  paymentMethod: Type.Union([Type.String(), Type.Null()]),
  transactionReference: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type DisbursementResponse = Static<typeof DisbursementResponseSchema>;

export const UtilizationReportResponseSchema = Type.Object({
  totalPrograms: Type.Number(),
  totalApplications: Type.Number(),
  totalApproved: Type.Number(),
  totalDisbursed: Type.Number(),
  totalAmount: Type.Number(),
  currency: Type.String(),
  breakdown: Type.Array(
    Type.Object({
      groupKey: Type.String(),
      groupValue: Type.String(),
      applicationCount: Type.Number(),
      approvedCount: Type.Number(),
      disbursedAmount: Type.Number(),
      utilizationRate: Type.Number(),
    }),
  ),
  generatedAt: Type.String(),
});

export type UtilizationReportResponse = Static<typeof UtilizationReportResponseSchema>;
