'use server';

/**
 * Server Actions for the staff management pages.
 *
 * All writes go through the API gateway (X-Tenant-ID enforced).
 * Validation is performed both client-side (react-hook-form + zod) and here
 * via the same zod schemas, so direct calls are safe.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { GatewayError } from '@/lib/api/gateway';
import {
  createAppraisal,
  createAssignment,
  createStaff,
  deleteStaff,
  updateStaff,
  type CreateAppraisalInput,
  type CreateAssignmentInput,
  type CreateStaffInput,
  type UpdateStaffInput,
} from '@/lib/api/staff';
import {
  appraisalFormSchema,
  assignmentFormSchema,
  staffFormSchema,
  type AppraisalFormValues,
  type AssignmentFormValues,
  type StaffFormValues,
} from '@/lib/validation/staff-schema';

export interface ActionState<T = unknown> {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
}

/* ------------------------------------------------------------------ Helpers */

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

function toCreateStaffInput(values: StaffFormValues): CreateStaffInput {
  const out: CreateStaffInput = {
    firstName: values.firstName,
    lastName: values.lastName,
    dateOfBirth: values.dateOfBirth,
    identityNumber: values.identityNumber,
    contactPhone: values.contactPhone,
    position: values.position,
  };
  if (values.contactEmail) out.contactEmail = values.contactEmail;
  return out;
}

function toUpdateStaffInput(values: StaffFormValues): UpdateStaffInput {
  return toCreateStaffInput(values);
}

/* ------------------------------------------------------------------ Create */

export async function createStaffAction(
  values: StaffFormValues,
): Promise<ActionState<{ staffId: string }>> {
  const parsed = staffFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const staff = await createStaff(toCreateStaffInput(parsed.data));
    revalidatePath('/staff');
    return {
      status: 'success',
      message: 'Staff record created successfully.',
      data: { staffId: staff.id },
    };
  } catch (error) {
    return toErrorState<{ staffId: string }>(error, 'Failed to create staff record');
  }
}

/* ------------------------------------------------------------------ Update */

export async function updateStaffAction(
  staffId: string,
  values: StaffFormValues,
): Promise<ActionState<{ staffId: string }>> {
  const parsed = staffFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const staff = await updateStaff(staffId, toUpdateStaffInput(parsed.data));
    revalidatePath('/staff');
    revalidatePath(`/staff/${staffId}`);
    return {
      status: 'success',
      message: 'Staff record updated.',
      data: { staffId: staff.id },
    };
  } catch (error) {
    return toErrorState<{ staffId: string }>(error, 'Failed to update staff record');
  }
}

/* ------------------------------------------------------------------ Delete */

export async function deleteStaffAction(staffId: string): Promise<ActionState> {
  try {
    await deleteStaff(staffId);
    revalidatePath('/staff');
  } catch (error) {
    return toErrorState(error, 'Failed to delete staff record');
  }
  redirect('/staff');
}

/* ------------------------------------------------------------ Assignments */

export async function createAssignmentAction(
  staffId: string,
  values: AssignmentFormValues,
): Promise<ActionState<{ assignmentId: string }>> {
  const parsed = assignmentFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  const payload: CreateAssignmentInput = {
    staffId,
    institutionId: parsed.data.institutionId,
    subjectId: parsed.data.subjectId,
    classId: parsed.data.classId,
    role: parsed.data.role,
    allocationPercentage: parsed.data.allocationPercentage,
    startDate: parsed.data.startDate,
  };
  if (parsed.data.endDate) payload.endDate = parsed.data.endDate;

  try {
    const assignment = await createAssignment(payload);
    revalidatePath(`/staff/${staffId}`);
    return {
      status: 'success',
      message: 'Assignment created.',
      data: { assignmentId: assignment.id },
    };
  } catch (error) {
    return toErrorState<{ assignmentId: string }>(error, 'Failed to create assignment');
  }
}

/* -------------------------------------------------------------- Appraisals */

export async function createAppraisalAction(
  staffId: string,
  values: AppraisalFormValues,
): Promise<ActionState<{ appraisalId: string }>> {
  const parsed = appraisalFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  const payload: CreateAppraisalInput = {
    staffId,
    templateId: parsed.data.templateId,
    appraisalDate: parsed.data.appraisalDate,
    scores: parsed.data.scores.map((entry) => {
      const out: { criterionName: string; score: number; comment?: string } = {
        criterionName: entry.criterionName,
        score: Number(entry.score),
      };
      if (entry.comment) out.comment = entry.comment;
      return out;
    }),
  };
  if (parsed.data.overallComment) payload.overallComment = parsed.data.overallComment;

  try {
    const appraisal = await createAppraisal(payload);
    revalidatePath(`/staff/${staffId}`);
    return {
      status: 'success',
      message: 'Appraisal recorded.',
      data: { appraisalId: appraisal.id },
    };
  } catch (error) {
    return toErrorState<{ appraisalId: string }>(error, 'Failed to record appraisal');
  }
}
