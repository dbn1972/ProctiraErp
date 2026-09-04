'use server';

/**
 * Server Actions for Survey module pages (ProctiraERP).
 *
 * Wraps survey CRUD, publish, distribute, and remind through the API gateway.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  createSurvey,
  deleteSurvey,
  distributeSurvey,
  sendSurveyReminders,
  updateSurvey,
  type CreateSurveyInput,
  type SurveyQuestion,
  type SurveyQuestionType,
  type UpdateSurveyInput,
} from '@/lib/api/surveys';
import { GatewayError } from '@/lib/api/gateway';

export interface ActionState<T = unknown> {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
}

function toErrorState<T = unknown>(
  error: unknown,
  fallback: string,
): ActionState<T> {
  if (error instanceof GatewayError) {
    return { status: 'error', message: error.message || fallback };
  }
  if (error instanceof Error) {
    return { status: 'error', message: error.message };
  }
  return { status: 'error', message: fallback };
}

const QUESTION_TYPES: SurveyQuestionType[] = [
  'text',
  'number',
  'date',
  'dropdown',
  'checkbox',
  'table',
  'repeater',
];

function parseQuestionsFromForm(formData: FormData): SurveyQuestion[] {
  const labels = formData.getAll('questionLabel').map(String);
  const types = formData.getAll('questionType').map(String);

  const questions: SurveyQuestion[] = [];
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]?.trim();
    if (!label) continue;
    const typeRaw = types[i] ?? 'text';
    const type = QUESTION_TYPES.includes(typeRaw as SurveyQuestionType)
      ? (typeRaw as SurveyQuestionType)
      : 'text';
    const requiredVals = formData
      .getAll(`questionRequired_${i}`)
      .map(String);
    questions.push({
      label,
      type,
      required: requiredVals.includes('true') || requiredVals.includes('on'),
      order: questions.length,
    });
  }
  return questions;
}

function parseSurveyFields(formData: FormData): {
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  questions: SurveyQuestion[];
} {
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const startDate = String(formData.get('startDate') ?? '').trim();
  const endDate = String(formData.get('endDate') ?? '').trim();
  const questions = parseQuestionsFromForm(formData);

  return {
    name,
    description: description || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    questions,
  };
}

export async function createSurveyAction(
  _prev: ActionState<{ surveyId: string }> | null,
  formData: FormData,
): Promise<ActionState<{ surveyId: string }>> {
  const fields = parseSurveyFields(formData);
  if (!fields.name) {
    return {
      status: 'error',
      message: 'Survey name is required.',
      fieldErrors: { name: 'Required' },
    };
  }
  if (fields.questions.length === 0) {
    return {
      status: 'error',
      message: 'Add at least one question.',
      fieldErrors: { questions: 'At least one question is required' },
    };
  }

  const input: CreateSurveyInput = {
    name: fields.name,
    questions: fields.questions,
  };
  if (fields.description) input.description = fields.description;
  if (fields.startDate) input.startDate = fields.startDate;
  if (fields.endDate) input.endDate = fields.endDate;

  try {
    const survey = await createSurvey(input);
    revalidatePath('/surveys');
    redirect(`/surveys/${survey.id}`);
  } catch (error) {
    // redirect() throws; rethrow those
    if (
      error &&
      typeof error === 'object' &&
      'digest' in error &&
      String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return toErrorState<{ surveyId: string }>(error, 'Failed to create survey');
  }
}

export async function updateSurveyAction(
  surveyId: string,
  _prev: ActionState<{ surveyId: string }> | null,
  formData: FormData,
): Promise<ActionState<{ surveyId: string }>> {
  const fields = parseSurveyFields(formData);
  if (!fields.name) {
    return {
      status: 'error',
      message: 'Survey name is required.',
      fieldErrors: { name: 'Required' },
    };
  }
  if (fields.questions.length === 0) {
    return {
      status: 'error',
      message: 'Add at least one question.',
      fieldErrors: { questions: 'At least one question is required' },
    };
  }

  const input: UpdateSurveyInput = {
    name: fields.name,
    questions: fields.questions,
    description: fields.description ?? '',
    startDate: fields.startDate,
    endDate: fields.endDate,
  };

  try {
    await updateSurvey(surveyId, input);
    revalidatePath('/surveys');
    revalidatePath(`/surveys/${surveyId}`);
    redirect(`/surveys/${surveyId}`);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'digest' in error &&
      String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return toErrorState<{ surveyId: string }>(error, 'Failed to update survey');
  }
}

export async function publishSurveyAction(
  surveyId: string,
): Promise<ActionState> {
  try {
    await updateSurvey(surveyId, { status: 'published' });
    revalidatePath('/surveys');
    revalidatePath(`/surveys/${surveyId}`);
    revalidatePath(`/surveys/${surveyId}/distributions`);
    return { status: 'success', message: 'Survey published.' };
  } catch (error) {
    return toErrorState(error, 'Failed to publish survey');
  }
}

export async function closeSurveyAction(surveyId: string): Promise<ActionState> {
  try {
    await updateSurvey(surveyId, { status: 'closed' });
    revalidatePath('/surveys');
    revalidatePath(`/surveys/${surveyId}`);
    return { status: 'success', message: 'Survey closed.' };
  } catch (error) {
    return toErrorState(error, 'Failed to close survey');
  }
}

export async function deleteSurveyAction(surveyId: string): Promise<ActionState> {
  try {
    await deleteSurvey(surveyId);
    revalidatePath('/surveys');
  } catch (error) {
    return toErrorState(error, 'Failed to delete survey');
  }
  redirect('/surveys');
}

export async function distributeSurveyAction(
  surveyId: string,
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState<{ distributed: number }>> {
  const dueDate = String(formData.get('dueDate') ?? '').trim();
  const areaIdsRaw = String(formData.get('areaIds') ?? '').trim();
  const institutionTypeIdsRaw = String(
    formData.get('institutionTypeIds') ?? '',
  ).trim();
  const classificationIdsRaw = String(
    formData.get('classificationIds') ?? '',
  ).trim();

  const splitIds = (raw: string) =>
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const areaIds = splitIds(areaIdsRaw);
  const institutionTypeIds = splitIds(institutionTypeIdsRaw);
  const classificationIds = splitIds(classificationIdsRaw);

  if (
    areaIds.length === 0 &&
    institutionTypeIds.length === 0 &&
    classificationIds.length === 0
  ) {
    return {
      status: 'error',
      message:
        'Provide at least one filter (area, institution type, or classification IDs).',
    };
  }

  try {
    const result = await distributeSurvey({
      surveyId,
      filters: {
        ...(areaIds.length ? { areaIds } : {}),
        ...(institutionTypeIds.length ? { institutionTypeIds } : {}),
        ...(classificationIds.length ? { classificationIds } : {}),
      },
      ...(dueDate ? { dueDate } : {}),
    });
    revalidatePath(`/surveys/${surveyId}`);
    revalidatePath(`/surveys/${surveyId}/distributions`);
    revalidatePath(`/surveys/${surveyId}/results`);
    return {
      status: 'success',
      message: `Distributed to ${result.distributed.toLocaleString()} institution(s).`,
      data: { distributed: result.distributed },
    };
  } catch (error) {
    return toErrorState<{ distributed: number }>(
      error,
      'Failed to distribute survey',
    );
  }
}

export async function remindSurveyAction(
  surveyId: string,
): Promise<ActionState<{ reminded: number }>> {
  try {
    const result = await sendSurveyReminders(surveyId);
    revalidatePath(`/surveys/${surveyId}/distributions`);
    return {
      status: 'success',
      message: `Reminders sent (${result.reminded.toLocaleString()}).`,
      data: { reminded: result.reminded },
    };
  } catch (error) {
    return toErrorState<{ reminded: number }>(error, 'Failed to send reminders');
  }
}
