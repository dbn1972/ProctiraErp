'use server';

/**
 * Server Actions for examination create / management pages.
 * Wraps POST /examinations through the API gateway examination plugin.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  allocateExamInvigilator,
  assignExamReevaluation,
  completeExamReevaluation,
  createExamReevaluation,
  createExamSession,
  createExamination,
  generateExamSeating,
  generateExaminationDocuments,
  publishExaminationResults,
  recordExamDoubleEntry,
  recordExaminationMarks,
  registerExaminationCandidate,
  resolveExamMarks,
  toCreateExaminationInput,
  type ExaminationDocumentType,
} from '@/lib/api/examinations';
import { GatewayError } from '@/lib/api/gateway';
import {
  createExaminationFormSchema,
  type CreateExaminationFormValues,
} from '@/lib/validation/examination-schema';

export interface ActionState<T = unknown> {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
}

function zodFlatten(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value && value.length > 0 && value[0]) out[key] = value[0];
  }
  return out;
}

function toErrorState<T = unknown>(error: unknown, fallback: string): ActionState<T> {
  if (error instanceof GatewayError) {
    return { status: 'error', message: error.message || fallback };
  }
  if (error instanceof Error) {
    return { status: 'error', message: error.message };
  }
  return { status: 'error', message: fallback };
}

export async function createExaminationAction(
  values: CreateExaminationFormValues,
): Promise<ActionState<{ examinationId: string }>> {
  const parsed = createExaminationFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const examination = await createExamination(toCreateExaminationInput(parsed.data));
    revalidatePath('/examinations');
    return {
      status: 'success',
      message: 'Examination created',
      data: { examinationId: examination.id },
    };
  } catch (error) {
    return toErrorState(
      error,
      'Could not create examination — gateway or examination service unavailable',
    );
  }
}

const UUID = z.string().uuid();

const registerCandidateSchema = z.object({
  examinationId: UUID,
  studentId: UUID,
  centerId: UUID,
  subjectIds: z.array(UUID).min(1, 'Select at least one subject'),
});

export async function registerCandidateAction(
  input: z.input<typeof registerCandidateSchema>,
): Promise<ActionState<{ candidateId: string }>> {
  const parsed = registerCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    const { examinationId, ...body } = parsed.data;
    const candidate = await registerExaminationCandidate(examinationId, body);
    revalidatePath(`/examinations/${examinationId}/candidates`);
    return {
      status: 'success',
      message: 'Candidate registered',
      data: { candidateId: candidate.id },
    };
  } catch (error) {
    return toErrorState(error, 'Could not register candidate');
  }
}

const recordMarksSchema = z.object({
  examinationId: UUID,
  entries: z
    .array(
      z.object({
        studentId: UUID,
        marks: z.array(z.object({ subjectId: UUID, score: z.number().min(0).nullable() })).min(1),
      }),
    )
    .min(1, 'No marks supplied'),
});

export async function recordMarksAction(
  input: z.input<typeof recordMarksSchema>,
): Promise<ActionState<{ candidateCount: number; subjectResultCount: number }>> {
  const parsed = recordMarksSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    const summary = await recordExaminationMarks(parsed.data.examinationId, {
      entries: parsed.data.entries,
    });
    revalidatePath(`/examinations/${parsed.data.examinationId}/results`);
    return {
      status: 'success',
      message: `Recorded ${summary.subjectResultCount} marks for ${summary.candidateCount} candidates`,
      data: summary,
    };
  } catch (error) {
    return toErrorState(error, 'Could not record marks');
  }
}

export async function publishResultsAction(
  examinationId: string,
): Promise<ActionState<{ processedCount: number; incompleteCount: number }>> {
  if (!UUID.safeParse(examinationId).success) {
    return { status: 'error', message: 'Invalid examination id' };
  }
  try {
    const summary = await publishExaminationResults(examinationId);
    revalidatePath(`/examinations/${examinationId}`);
    revalidatePath(`/examinations/${examinationId}/results`);
    return {
      status: 'success',
      message: `Published results for ${summary.processedCount} candidates`,
      data: summary,
    };
  } catch (error) {
    return toErrorState(error, 'Could not publish results');
  }
}

export async function generateDocumentsAction(
  examinationId: string,
  documentType: ExaminationDocumentType,
): Promise<ActionState<{ jobId: string; status: string }>> {
  if (!UUID.safeParse(examinationId).success) {
    return { status: 'error', message: 'Invalid examination id' };
  }
  try {
    const job = await generateExaminationDocuments(examinationId, documentType);
    revalidatePath(`/examinations/${examinationId}/documents`);
    return {
      status: job.status === 'failed' ? 'error' : 'success',
      message:
        job.status === 'failed'
          ? (job.errorMessage ?? 'Document generation failed')
          : `Generated ${job.documentType.replace('_', ' ')} for ${job.totalCandidates} candidates`,
      data: { jobId: job.id, status: job.status },
    };
  } catch (error) {
    return toErrorState(error, 'Could not generate documents');
  }
}

function revalidateOps(examinationId: string) {
  revalidatePath(`/examinations/${examinationId}/ops`);
}

const createSessionSchema = z.object({
  examinationId: UUID,
  subjectId: UUID,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  roomId: z.string().trim().min(1).max(100),
  centerId: UUID.optional(),
});

export async function createExamSessionAction(
  input: z.input<typeof createSessionSchema>,
): Promise<ActionState<{ sessionId: string }>> {
  const parsed = createSessionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    const session = await createExamSession(parsed.data.examinationId, {
      subjectId: parsed.data.subjectId,
      date: parsed.data.date,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      roomId: parsed.data.roomId,
      centerId: parsed.data.centerId,
    });
    revalidateOps(parsed.data.examinationId);
    return { status: 'success', message: 'Session created', data: { sessionId: session.id } };
  } catch (error) {
    return toErrorState(error, 'Could not create session');
  }
}

const allocateSchema = z.object({
  examinationId: UUID,
  sessionId: UUID,
  staffId: UUID,
});

export async function allocateInvigilatorAction(
  input: z.input<typeof allocateSchema>,
): Promise<ActionState<{ allocationId: string }>> {
  const parsed = allocateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    const allocation = await allocateExamInvigilator(
      parsed.data.examinationId,
      parsed.data.sessionId,
      parsed.data.staffId,
    );
    revalidateOps(parsed.data.examinationId);
    return {
      status: 'success',
      message: 'Invigilator allocated',
      data: { allocationId: allocation.id },
    };
  } catch (error) {
    return toErrorState(error, 'Could not allocate invigilator');
  }
}

export async function generateSeatingAction(
  examinationId: string,
): Promise<ActionState<{ count: number }>> {
  if (!UUID.safeParse(examinationId).success) {
    return { status: 'error', message: 'Invalid examination id' };
  }
  try {
    const seats = await generateExamSeating(examinationId);
    revalidateOps(examinationId);
    return {
      status: 'success',
      message: `Seating generated for ${seats.length} candidates`,
      data: { count: seats.length },
    };
  } catch (error) {
    return toErrorState(error, 'Could not generate seating');
  }
}

const doubleEntrySchema = z.object({
  examinationId: UUID,
  candidateId: UUID,
  subjectId: UUID,
  entryNo: z.union([z.literal(1), z.literal(2)]),
  marks: z.coerce.number().min(0),
});

export async function recordDoubleEntryAction(
  input: z.input<typeof doubleEntrySchema>,
): Promise<ActionState<{ varianceFlag: boolean }>> {
  const parsed = doubleEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    const entry = await recordExamDoubleEntry(parsed.data.examinationId, {
      candidateId: parsed.data.candidateId,
      subjectId: parsed.data.subjectId,
      entryNo: parsed.data.entryNo,
      marks: parsed.data.marks,
    });
    revalidateOps(parsed.data.examinationId);
    return {
      status: 'success',
      message: entry.varianceFlag ? 'Second entry recorded — variance flagged' : 'Marks recorded',
      data: { varianceFlag: entry.varianceFlag },
    };
  } catch (error) {
    return toErrorState(error, 'Could not record marks entry');
  }
}

const resolveSchema = z.object({
  examinationId: UUID,
  candidateId: UUID,
  subjectId: UUID,
  finalMarks: z.coerce.number().min(0),
});

export async function resolveMarksAction(
  input: z.input<typeof resolveSchema>,
): Promise<ActionState<{ finalMarks: number | null }>> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    const view = await resolveExamMarks(parsed.data.examinationId, {
      candidateId: parsed.data.candidateId,
      subjectId: parsed.data.subjectId,
      finalMarks: parsed.data.finalMarks,
    });
    revalidateOps(parsed.data.examinationId);
    return {
      status: 'success',
      message: 'Marks resolved',
      data: { finalMarks: view.finalMarks },
    };
  } catch (error) {
    return toErrorState(error, 'Could not resolve marks');
  }
}

const reevalRequestSchema = z.object({
  examinationId: UUID,
  candidateId: UUID,
  subjectId: UUID,
  originalMarks: z.coerce.number().min(0).optional(),
  notes: z.string().max(2000).optional(),
});

export async function requestReevaluationAction(
  input: z.input<typeof reevalRequestSchema>,
): Promise<ActionState<{ requestId: string }>> {
  const parsed = reevalRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    const row = await createExamReevaluation(parsed.data.examinationId, {
      candidateId: parsed.data.candidateId,
      subjectId: parsed.data.subjectId,
      originalMarks: parsed.data.originalMarks,
      notes: parsed.data.notes,
    });
    revalidateOps(parsed.data.examinationId);
    return { status: 'success', message: 'Re-evaluation requested', data: { requestId: row.id } };
  } catch (error) {
    return toErrorState(error, 'Could not request re-evaluation');
  }
}

const assignSchema = z.object({
  examinationId: UUID,
  requestId: UUID,
  evaluatorId: UUID,
});

export async function assignReevaluationAction(
  input: z.input<typeof assignSchema>,
): Promise<ActionState> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    await assignExamReevaluation(
      parsed.data.examinationId,
      parsed.data.requestId,
      parsed.data.evaluatorId,
    );
    revalidateOps(parsed.data.examinationId);
    return { status: 'success', message: 'Evaluator assigned' };
  } catch (error) {
    return toErrorState(error, 'Could not assign evaluator');
  }
}

const completeSchema = z.object({
  examinationId: UUID,
  requestId: UUID,
  revisedMarks: z.coerce.number().min(0),
  notes: z.string().max(2000).optional(),
});

export async function completeReevaluationAction(
  input: z.input<typeof completeSchema>,
): Promise<ActionState> {
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Validation failed',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    await completeExamReevaluation(
      parsed.data.examinationId,
      parsed.data.requestId,
      parsed.data.revisedMarks,
      parsed.data.notes,
    );
    revalidateOps(parsed.data.examinationId);
    return { status: 'success', message: 'Re-evaluation completed' };
  } catch (error) {
    return toErrorState(error, 'Could not complete re-evaluation');
  }
}
