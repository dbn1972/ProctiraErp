/**
 * Typebox schemas for Staff / HR ops (G-918): contracts, qualifications,
 * attendance, CSV import, payroll export.
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const MONTH_PATTERN = '^\\d{4}-\\d{2}$';

export const ContractTypeSchema = Type.Union([
  Type.Literal('permanent'),
  Type.Literal('probation'),
  Type.Literal('fixed_term'),
  Type.Literal('visiting'),
  Type.Literal('intern'),
]);

export const ContractStatusSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('active'),
  Type.Literal('expired'),
  Type.Literal('terminated'),
]);

export const AttendanceStatusSchema = Type.Union([
  Type.Literal('present'),
  Type.Literal('absent'),
  Type.Literal('leave'),
  Type.Literal('half_day'),
]);

export const CreateContractSchema = Type.Object({
  staffId: Type.String({ pattern: UUID_PATTERN }),
  contractType: ContractTypeSchema,
  startDate: Type.String({ pattern: DATE_PATTERN }),
  endDate: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
  salaryBand: Type.Optional(Type.String({ maxLength: 64 })),
  monthlyGrossCents: Type.Optional(Type.Integer({ minimum: 0 })),
  status: Type.Optional(ContractStatusSchema),
  notes: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type CreateContractInput = Static<typeof CreateContractSchema>;

export const UpdateContractSchema = Type.Object({
  contractType: Type.Optional(ContractTypeSchema),
  startDate: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
  endDate: Type.Optional(Type.Union([Type.String({ pattern: DATE_PATTERN }), Type.Null()])),
  salaryBand: Type.Optional(Type.String({ maxLength: 64 })),
  monthlyGrossCents: Type.Optional(Type.Integer({ minimum: 0 })),
  status: Type.Optional(ContractStatusSchema),
  notes: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
});
export type UpdateContractInput = Static<typeof UpdateContractSchema>;

export const ContractParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});
export type ContractParams = Static<typeof ContractParamsSchema>;

export const ContractListQuerySchema = Type.Object({
  staffId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
});
export type ContractListQuery = Static<typeof ContractListQuerySchema>;

export const CreateQualificationSchema = Type.Object({
  staffId: Type.String({ pattern: UUID_PATTERN }),
  degree: Type.String({ minLength: 1, maxLength: 200 }),
  institution: Type.String({ minLength: 1, maxLength: 200 }),
  year: Type.Integer({ minimum: 1950, maximum: 2100 }),
  verified: Type.Optional(Type.Boolean()),
  documentRef: Type.Optional(Type.String({ maxLength: 512 })),
});
export type CreateQualificationInput = Static<typeof CreateQualificationSchema>;

export const QualificationParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});
export type QualificationParams = Static<typeof QualificationParamsSchema>;

export const VerifyQualificationSchema = Type.Object({
  verified: Type.Boolean(),
  documentRef: Type.Optional(Type.String({ maxLength: 512 })),
});
export type VerifyQualificationInput = Static<typeof VerifyQualificationSchema>;

export const QualificationListQuerySchema = Type.Object({
  staffId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
});
export type QualificationListQuery = Static<typeof QualificationListQuerySchema>;

export const MarkAttendanceSchema = Type.Object({
  staffId: Type.String({ pattern: UUID_PATTERN }),
  date: Type.String({ pattern: DATE_PATTERN }),
  status: AttendanceStatusSchema,
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});
export type MarkAttendanceInput = Static<typeof MarkAttendanceSchema>;

export const BulkAttendanceSchema = Type.Object({
  date: Type.String({ pattern: DATE_PATTERN }),
  marks: Type.Array(
    Type.Object({
      staffId: Type.String({ pattern: UUID_PATTERN }),
      status: AttendanceStatusSchema,
      notes: Type.Optional(Type.String({ maxLength: 1000 })),
    }),
    { minItems: 1, maxItems: 500 },
  ),
});
export type BulkAttendanceInput = Static<typeof BulkAttendanceSchema>;

export const AttendanceListQuerySchema = Type.Object({
  date: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
  staffId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  from: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
  to: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
});
export type AttendanceListQuery = Static<typeof AttendanceListQuerySchema>;

export const AttendanceSummaryQuerySchema = Type.Object({
  month: Type.String({ pattern: MONTH_PATTERN }),
  staffId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
});
export type AttendanceSummaryQuery = Static<typeof AttendanceSummaryQuerySchema>;

export const StaffImportSchema = Type.Object({
  csv: Type.String({ minLength: 1, maxLength: 1_000_000 }),
  filename: Type.Optional(Type.String({ maxLength: 255 })),
});
export type StaffImportInput = Static<typeof StaffImportSchema>;

export const PayrollExportQuerySchema = Type.Object({
  month: Type.String({ pattern: MONTH_PATTERN }),
});
export type PayrollExportQuery = Static<typeof PayrollExportQuerySchema>;
