'use server';

/**
 * Server Actions for institution and academic period management.
 *
 * These actions are invoked from React form components (Client or Server)
 * and proxy validated input to the institution backend service.
 */
import { revalidatePath } from 'next/cache';

import {
  ApiClientError,
  createAcademicPeriod,
  createClassSection,
  createGrade,
  createInstitution,
  deactivateInstitution,
  deleteAcademicPeriod,
  updateAcademicPeriod,
  updateInstitution,
} from './api';
import {
  academicPeriodFormSchema,
  classSectionFormSchema,
  gradeFormSchema,
  institutionFormSchema,
  type AcademicPeriodFormValues,
  type ClassSectionFormValues,
  type GradeFormValues,
  type InstitutionFormValues,
} from './validation';

export interface FieldError {
  field: string;
  message: string;
}

export type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: FieldError[] };

function flattenZodErrors(errors: Record<string, string[] | undefined>): FieldError[] {
  return Object.entries(errors).flatMap(([field, messages]) =>
    (messages ?? []).map((message) => ({ field, message })),
  );
}

function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof ApiClientError) {
    return {
      success: false,
      error: error.message,
      fieldErrors: error.fieldErrors?.map((e) => ({ field: e.field, message: e.message })),
    };
  }
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unexpected error',
  };
}

// ---------------------------------------------------------------------------
// Institutions
// ---------------------------------------------------------------------------

export async function createInstitutionAction(
  values: InstitutionFormValues,
): Promise<ActionResult<{ id: string }>> {
  const parsed = institutionFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed',
      fieldErrors: flattenZodErrors(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const institution = await createInstitution(parsed.data);
    revalidatePath('/institutions');
    return { success: true, data: { id: institution.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateInstitutionAction(
  id: string,
  values: InstitutionFormValues,
): Promise<ActionResult<{ id: string }>> {
  const parsed = institutionFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed',
      fieldErrors: flattenZodErrors(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const institution = await updateInstitution(id, parsed.data);
    revalidatePath('/institutions');
    revalidatePath(`/institutions/${id}`);
    return { success: true, data: { id: institution.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deactivateInstitutionAction(
  id: string,
  reason: string,
): Promise<ActionResult<{ id: string }>> {
  if (!reason || reason.trim().length === 0) {
    return {
      success: false,
      error: 'A deactivation reason is required',
      fieldErrors: [{ field: 'reason', message: 'A deactivation reason is required' }],
    };
  }

  try {
    const institution = await deactivateInstitution(id, reason.trim());
    revalidatePath('/institutions');
    revalidatePath(`/institutions/${id}`);
    return { success: true, data: { id: institution.id } };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Academic Periods
// ---------------------------------------------------------------------------

export async function createAcademicPeriodAction(
  values: AcademicPeriodFormValues,
): Promise<ActionResult<{ id: string }>> {
  const parsed = academicPeriodFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed',
      fieldErrors: flattenZodErrors(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const period = await createAcademicPeriod(parsed.data);
    revalidatePath('/academic-periods');
    return { success: true, data: { id: period.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateAcademicPeriodAction(
  id: string,
  values: AcademicPeriodFormValues,
): Promise<ActionResult<{ id: string }>> {
  const parsed = academicPeriodFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed',
      fieldErrors: flattenZodErrors(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const period = await updateAcademicPeriod(id, parsed.data);
    revalidatePath('/academic-periods');
    return { success: true, data: { id: period.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteAcademicPeriodAction(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    await deleteAcademicPeriod(id);
    revalidatePath('/academic-periods');
    return { success: true, data: { id } };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// G-901 — Grades & class sections
// ---------------------------------------------------------------------------

export async function createGradeAction(
  values: GradeFormValues,
): Promise<ActionResult<{ id: string }>> {
  const parsed = gradeFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed',
      fieldErrors: flattenZodErrors(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    const grade = await createGrade(parsed.data);
    revalidatePath('/institutions', 'layout');
    return { success: true, data: { id: grade.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function createClassSectionAction(
  values: ClassSectionFormValues,
): Promise<ActionResult<{ id: string }>> {
  const parsed = classSectionFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed',
      fieldErrors: flattenZodErrors(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    const section = await createClassSection(parsed.data);
    revalidatePath(`/institutions/${parsed.data.institutionId}`, 'layout');
    return { success: true, data: { id: section.id } };
  } catch (error) {
    return toActionError(error);
  }
}
