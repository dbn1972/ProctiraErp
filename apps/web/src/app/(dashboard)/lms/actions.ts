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

export async function createAssignmentAction(
  input: CreateAssignmentInput,
): Promise<LmsActionState> {
  try {
    const created = await createAssignment(input);
    revalidatePath('/lms');
    return { status: 'success', id: created.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to create assignment') };
  }
}

export async function publishAssignmentAction(id: string): Promise<LmsActionState> {
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
  try {
    await gradeSubmission(submissionId, input);
    revalidatePath(`/lms/assignments/${assignmentId}`);
    return { status: 'success', id: submissionId };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to grade submission') };
  }
}

export async function createSkillAction(input: CreateSkillInput): Promise<LmsActionState> {
  try {
    const skill = await createSkill(input);
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
