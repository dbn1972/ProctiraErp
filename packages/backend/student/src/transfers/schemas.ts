import { Type, type Static } from '@sinclair/typebox';

const Uuid = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});

export const CreateTransferBodySchema = Type.Object({
  studentId: Uuid,
  sourceEnrollmentId: Uuid,
  sourceInstitutionId: Uuid,
  destinationInstitutionId: Uuid,
  destinationGradeId: Uuid,
  destinationClassId: Uuid,
  academicPeriodId: Uuid,
  reason: Type.String({ minLength: 1, maxLength: 500 }),
  transferDate: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  sourceBoardId: Type.Optional(Uuid),
  destinationBoardId: Type.Optional(Uuid),
  sourceBoardCode: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  destinationBoardCode: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  studentName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  sourceInstitutionName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  destinationInstitutionName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

export type CreateTransferBody = Static<typeof CreateTransferBodySchema>;

export const DecisionBodySchema = Type.Object({
  comment: Type.Optional(Type.String({ maxLength: 2000 })),
});

export type DecisionBody = Static<typeof DecisionBodySchema>;

export const EquivalencyBodySchema = Type.Object({
  sourceBoardId: Uuid,
  targetBoardId: Uuid,
  sourceGradeCode: Type.String({ minLength: 1, maxLength: 40 }),
  targetGradeCode: Type.String({ minLength: 1, maxLength: 40 }),
  sourceSubject: Type.String({ minLength: 1, maxLength: 120 }),
  targetSubject: Type.String({ minLength: 1, maxLength: 120 }),
  sourceMarksMax: Type.Number({ exclusiveMinimum: 0 }),
  targetMarksMax: Type.Number({ exclusiveMinimum: 0 }),
  creditFactor: Type.Number({ minimum: 0 }),
  mappingStatus: Type.Union([Type.Literal('mapped'), Type.Literal('bridge'), Type.Literal('na')]),
  notes: Type.Optional(Type.String({ maxLength: 500 })),
});

export type EquivalencyBody = Static<typeof EquivalencyBodySchema>;

export const EquivalencyParamsSchema = Type.Object({ id: Uuid });
export type EquivalencyParams = Static<typeof EquivalencyParamsSchema>;

export const EquivalencyQuerySchema = Type.Object({
  sourceBoardId: Type.Optional(Uuid),
  targetBoardId: Type.Optional(Uuid),
  gradeCode: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
});
export type EquivalencyQuery = Static<typeof EquivalencyQuerySchema>;
