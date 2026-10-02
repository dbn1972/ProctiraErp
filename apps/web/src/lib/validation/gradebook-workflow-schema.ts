import { z } from 'zod';

export const gradeWorkflowActionSchema = z.enum([
  'submit',
  'approve',
  'reject',
  'lock',
  'publish',
  'reopen',
]);

export const transitionGradeFormSchema = z.object({
  id: z.string().min(1),
  action: gradeWorkflowActionSchema,
  institutionId: z.string().min(1),
});

export const bulkTransitionGradeFormSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: gradeWorkflowActionSchema,
  institutionId: z.string().min(1),
});

export const commentsBankFormSchema = z.object({
  institutionId: z.string().min(1),
  subjectId: z.string().optional().or(z.literal('')),
  gradeBand: z.string().max(20).optional().or(z.literal('')),
  label: z.string().trim().min(1, 'Label is required').max(200),
  body: z.string().trim().min(1, 'Comment is required').max(4000),
});

export const computeRankFormSchema = z.object({
  sectionId: z.string().min(1),
  institutionId: z.string().min(1),
  academicPeriodId: z.string().optional().or(z.literal('')),
  boardId: z.string().optional().or(z.literal('')),
});

export type GradeWorkflowActionValue = z.infer<typeof gradeWorkflowActionSchema>;

/*
 * PRC-L239 — web-tier boundary schemas mirroring the gradebook TypeBox
 * schemas (packages/backend/gradebook/src/schemas.ts) with UUID ids. `.strict()`
 * rejects unknown keys so a crafted action payload cannot smuggle fields.
 */
const uuid = z.string().uuid();
const optionalUuid = uuid.nullish();

export const upsertGradeEntryActionSchema = z
  .object({
    sectionId: optionalUuid,
    studentId: uuid,
    assessmentCode: z.string().max(100).nullish(),
    numericScore: z.number().finite().min(0).max(100).nullish(),
    letterGrade: z.string().max(10).nullish(),
    creditRuleCode: z.string().max(50).nullish(),
    remark: z.string().max(4000).nullish(),
    commentBankId: optionalUuid,
    institutionId: uuid.optional(),
  })
  .strict();

export const computeGpaActionSchema = z
  .object({
    studentId: uuid,
    academicPeriodId: optionalUuid,
    boardId: optionalUuid,
    institutionId: uuid.optional(),
  })
  .strict();

export const issueTranscriptActionSchema = z
  .object({ studentId: uuid, gpaSnapshotId: optionalUuid })
  .strict();

export const createReportCardJobActionSchema = z
  .object({
    studentId: uuid,
    boardId: uuid,
    institutionId: optionalUuid,
    academicPeriodId: optionalUuid,
  })
  .strict();

export const createBoardExportJobActionSchema = z
  .object({
    boardId: uuid.optional(),
    boardCode: z.string().min(1).max(32).optional(),
    institutionId: uuid,
    studentIds: z.array(uuid).max(500).optional(),
  })
  .strict();
