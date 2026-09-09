'use server';

/**
 * Server Actions for examination create / management pages.
 * Wraps POST /examinations through the API gateway examination plugin.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  createExamination,
  generateExaminationDocuments,
  publishExaminationResults,
  recordExaminationMarks,
  registerExaminationCandidate,
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
