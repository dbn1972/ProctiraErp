'use server';

/**
 * Server Actions for examination create / management pages.
 * Wraps POST /examinations through the API gateway examination plugin.
 */
import { revalidatePath } from 'next/cache';

import {
  createExamination,
  toCreateExaminationInput,
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

function zodFlatten(
  fieldErrors: Record<string, string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value && value.length > 0 && value[0]) out[key] = value[0];
  }
  return out;
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
    const examination = await createExamination(
      toCreateExaminationInput(parsed.data),
    );
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
