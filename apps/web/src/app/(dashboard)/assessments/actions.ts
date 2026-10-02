'use server';

/**
 * Server Actions for the assessment management pages.
 *
 * Wraps grading scheme CRUD, assessment-item definition, and bulk result
 * entry / Excel import calls through the API gateway.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  createGradingScheme,
  defineAssessmentItems,
  deleteGradingScheme,
  enterBulkResults,
  importResultsFromExcel,
  createOutcome,
  updateGradingScheme,
  type BulkResultEntryResponse,
  type CreateGradingSchemeInput,
  type DefineAssessmentItemsInput,
  type UpdateGradingSchemeInput,
} from '@/lib/api/assessments';
import { GatewayError } from '@/lib/api/gateway';
import { INVALID_ID_MESSAGE, areValidActionIds } from '@/lib/validation/campus-action-schema';
import {
  assessmentItemsFormSchema,
  gradingSchemeFormSchema,
  type AssessmentItemsFormValues,
  type GradingSchemeFormValues,
} from '@/lib/validation/assessment-schema';

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

function toCreateSchemeInput(values: GradingSchemeFormValues): CreateGradingSchemeInput {
  return {
    name: values.name,
    type: values.type,
    minValue: values.minValue,
    maxValue: values.maxValue,
    thresholds: values.thresholds.map((t) => {
      const out: CreateGradingSchemeInput['thresholds'][number] = {
        grade: t.grade,
        minScore: t.minScore,
        maxScore: t.maxScore,
      };
      if (t.descriptor) out.descriptor = t.descriptor;
      return out;
    }),
  };
}

/* ----------------------------------------------------- Grading Schemes */

export async function createGradingSchemeAction(
  values: GradingSchemeFormValues,
): Promise<ActionState<{ schemeId: string }>> {
  const parsed = gradingSchemeFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const scheme = await createGradingScheme(toCreateSchemeInput(parsed.data));
    revalidatePath('/assessments');
    return {
      status: 'success',
      message: 'Grading scheme created.',
      data: { schemeId: scheme.id },
    };
  } catch (error) {
    return toErrorState<{ schemeId: string }>(error, 'Failed to create grading scheme');
  }
}

export async function updateGradingSchemeAction(
  schemeId: string,
  values: GradingSchemeFormValues,
): Promise<ActionState<{ schemeId: string }>> {
  const parsed = gradingSchemeFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  const payload: UpdateGradingSchemeInput = toCreateSchemeInput(parsed.data);

  try {
    const scheme = await updateGradingScheme(schemeId, payload);
    revalidatePath('/assessments');
    revalidatePath(`/assessments/schemes/${schemeId}/edit`);
    return {
      status: 'success',
      message: 'Grading scheme updated.',
      data: { schemeId: scheme.id },
    };
  } catch (error) {
    return toErrorState<{ schemeId: string }>(error, 'Failed to update grading scheme');
  }
}

export async function deleteGradingSchemeAction(schemeId: string): Promise<ActionState> {
  // PRC-L232: the id is interpolated into the gateway path.
  if (!areValidActionIds(schemeId)) return { status: 'error', message: INVALID_ID_MESSAGE };
  try {
    await deleteGradingScheme(schemeId);
    revalidatePath('/assessments');
  } catch (error) {
    return toErrorState(error, 'Failed to delete grading scheme');
  }
  redirect('/assessments');
}

/* ----------------------------------------------------- Assessment Items */

export async function defineAssessmentItemsAction(
  values: AssessmentItemsFormValues,
): Promise<ActionState<{ totalWeight: number }>> {
  const parsed = assessmentItemsFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  const payload: DefineAssessmentItemsInput = {
    subjectId: parsed.data.subjectId,
    academicPeriodId: parsed.data.academicPeriodId,
    gradingSchemeId: parsed.data.gradingSchemeId,
    items: parsed.data.items.map((item) => ({
      name: item.name,
      weight: item.weight,
      minScore: item.minScore,
      maxScore: item.maxScore,
    })),
  };

  try {
    const result = await defineAssessmentItems(payload);
    revalidatePath('/assessments/items');
    return {
      status: 'success',
      message: `Saved ${result.items.length} items (total weight ${result.totalWeight}%).`,
      data: { totalWeight: result.totalWeight },
    };
  } catch (error) {
    return toErrorState<{ totalWeight: number }>(error, 'Failed to save assessment items');
  }
}

/* --------------------------------------------------------- Bulk Results */

export interface BulkResultsActionInput {
  subjectId: string;
  academicPeriodId: string;
  results: Array<{
    studentId: string;
    assessmentItemId: string;
    score: number;
  }>;
}

/** Mirrors the assessment service's 5,000-row limit for bulk entry/import. */
const MAX_BULK_RESULT_ROWS = 5000;
const bulkResultsSchema = z.object({
  subjectId: z.string().uuid('Subject is invalid.'),
  academicPeriodId: z.string().uuid('Academic period is invalid.'),
  results: z
    .array(
      z.object({
        studentId: z.string().uuid('Student id is invalid.'),
        assessmentItemId: z.string().uuid('Assessment item is invalid.'),
        score: z.number().finite('Score must be a finite number.'),
      }),
    )
    .min(1, 'No score entries supplied.')
    .max(MAX_BULK_RESULT_ROWS, `At most ${MAX_BULK_RESULT_ROWS} results per save.`),
});

function parseBulkResultsInput(
  input: BulkResultsActionInput,
): { ok: true; data: z.infer<typeof bulkResultsSchema> } | { ok: false; message: string } {
  if (!input?.subjectId || !input.academicPeriodId) {
    return { ok: false, message: 'Subject and academic period are required.' };
  }
  const parsed = bulkResultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid results.' };
  }
  return { ok: true, data: parsed.data };
}

export async function submitBulkResultsAction(
  input: BulkResultsActionInput,
): Promise<ActionState<BulkResultEntryResponse>> {
  const parsed = parseBulkResultsInput(input);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  try {
    const response = await enterBulkResults(parsed.data);
    revalidatePath('/assessments/results');
    return {
      status: 'success',
      message: `Saved ${response.successCount} of ${response.totalRows} results.`,
      data: response,
    };
  } catch (error) {
    return toErrorState<BulkResultEntryResponse>(error, 'Failed to save results');
  }
}

export async function importResultsFromExcelAction(
  input: BulkResultsActionInput,
): Promise<ActionState<BulkResultEntryResponse>> {
  const parsed = parseBulkResultsInput(input);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  try {
    const response = await importResultsFromExcel({
      subjectId: parsed.data.subjectId,
      academicPeriodId: parsed.data.academicPeriodId,
      rows: parsed.data.results,
    });
    revalidatePath('/assessments/results');
    return {
      status: 'success',
      message: `Imported ${response.successCount} of ${response.totalRows} rows.`,
      data: response,
    };
  } catch (error) {
    return toErrorState<BulkResultEntryResponse>(error, 'Failed to import results');
  }
}

export async function createOutcomeAction(input: {
  subjectId: string;
  name: string;
  code: string;
  description?: string;
}): Promise<ActionState<{ id: string }>> {
  const subjectId = String(input?.subjectId ?? '').trim();
  const name = String(input?.name ?? '').trim();
  const code = String(input?.code ?? '').trim();
  if (subjectId && !areValidActionIds(subjectId)) {
    return { status: 'error', message: INVALID_ID_MESSAGE, fieldErrors: { subjectId: 'Invalid' } };
  }
  if (name.length > 255 || code.length > 64 || (input.description ?? '').length > 2000) {
    return { status: 'error', message: 'Name, code or description is too long.' };
  }
  if (!subjectId) {
    return {
      status: 'error',
      message: 'Subject is required.',
      fieldErrors: { subjectId: 'Required' },
    };
  }
  if (!name) {
    return { status: 'error', message: 'Name is required.', fieldErrors: { name: 'Required' } };
  }
  if (!code) {
    return { status: 'error', message: 'Code is required.', fieldErrors: { code: 'Required' } };
  }
  try {
    const row = await createOutcome({
      subjectId,
      name,
      code,
      description: input.description?.trim() || undefined,
    });
    revalidatePath('/assessments/outcomes');
    return { status: 'success', message: 'Outcome saved.', data: { id: row.id } };
  } catch (error) {
    return toErrorState(error, 'Failed to create outcome');
  }
}
