'use server';

/**
 * Server Actions for the LMS module (assignments · homework · quizzes · Spiral PAL).
 */
import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  closeAssignment,
  createAssignment,
  createSkill,
  getStudentPlan,
  getStudentProgress,
  gradeSubmission,
  publishAssignment,
  type CreateAssignmentInput,
  type CreateSkillInput,
  type GradeSubmissionInput,
  type SpiralPlan,
  type StudentProgress,
} from '@/lib/api/lms';
import {
  createAssignmentSchema,
  createSkillSchema,
  firstIssue,
  gradeSubmissionSchema,
  lmsIdSchema,
  palLookupQuerySchema,
} from '@/lib/validation/lms-schema';

export interface LmsActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof GatewayError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
function emptyToUndefined(value?: string): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export async function createAssignmentAction(
  input: CreateAssignmentInput,
): Promise<LmsActionState> {
  const parsed = createAssignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Invalid assignment') };
  }
  const data = parsed.data;
  try {
    const created = await createAssignment({
      ...data,
      boardId: emptyToUndefined(data.boardId),
      institutionId: emptyToUndefined(data.institutionId),
    });
    revalidatePath('/lms');
    return { status: 'success', id: created.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to create assignment') };
  }
}

export async function publishAssignmentAction(id: string): Promise<LmsActionState> {
  if (!lmsIdSchema.safeParse(id).success) {
    return { status: 'error', message: 'Invalid assignment id' };
  }
  try {
    await publishAssignment(id);
    revalidatePath('/lms');
    revalidatePath(`/lms/assignments/${id}`);
    return { status: 'success', id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to publish') };
  }
}

export async function closeAssignmentAction(id: string): Promise<LmsActionState> {
  if (!lmsIdSchema.safeParse(id).success) {
    return { status: 'error', message: 'Invalid assignment id' };
  }
  try {
    await closeAssignment(id);
    revalidatePath('/lms');
    revalidatePath(`/lms/assignments/${id}`);
    return { status: 'success', id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to close') };
  }
}

export async function gradeSubmissionAction(
  assignmentId: string,
  submissionId: string,
  input: GradeSubmissionInput,
): Promise<LmsActionState> {
  if (
    !lmsIdSchema.safeParse(assignmentId).success ||
    !lmsIdSchema.safeParse(submissionId).success
  ) {
    return { status: 'error', message: 'Invalid submission id' };
  }
  const parsed = gradeSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Invalid grade') };
  }
  try {
    await gradeSubmission(submissionId, parsed.data);
    revalidatePath(`/lms/assignments/${assignmentId}`);
    return { status: 'success', id: submissionId };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to grade submission') };
  }
}

export async function createSkillAction(input: CreateSkillInput): Promise<LmsActionState> {
  const parsed = createSkillSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: firstIssue(parsed.error, 'Invalid skill') };
  }
  const data = parsed.data;
  try {
    const skill = await createSkill({
      ...data,
      boardId: emptyToUndefined(data.boardId),
      institutionId: emptyToUndefined(data.institutionId),
    });
    revalidatePath('/lms/pal');
    return { status: 'success', id: skill.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to create skill') };
  }
}

export interface PalLookupState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  plan?: SpiralPlan | null;
  progress?: StudentProgress | null;
}

export async function lookupStudentPalAction(
  studentId: string,
  query: { boardId?: string; institutionId?: string } = {},
): Promise<PalLookupState> {
  const parsedQuery = palLookupQuerySchema.safeParse(query);
  if (!lmsIdSchema.safeParse(studentId).success || !parsedQuery.success) {
    return { status: 'error', message: 'Invalid learner id' };
  }
  query = parsedQuery.data;
  try {
    const [plan, progress] = await Promise.all([
      getStudentPlan(studentId, { ...query, limit: 10 }),
      getStudentProgress(studentId, query),
    ]);
    if (!plan && !progress) {
      return { status: 'error', message: 'No plan available for this learner.' };
    }
    return { status: 'success', plan, progress };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to load learner plan') };
  }
}
