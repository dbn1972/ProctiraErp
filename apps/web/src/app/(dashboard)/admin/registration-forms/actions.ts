'use server';

/**
 * Server Actions for registration form configurations.
 */
import { revalidatePath } from 'next/cache';

import {
  upsertFormConfiguration,
  type FormConfiguration,
  type FormFieldDefinition,
  type FormFieldType,
} from '@/lib/api/form-configurations';
import { GatewayError } from '@/lib/api/gateway';

export interface ActionState<T = unknown> {
  status: 'idle' | 'success' | 'error';
  message?: string;
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

const FIELD_TYPES = new Set<FormFieldType>([
  'text',
  'number',
  'date',
  'select',
  'checkbox',
  'textarea',
  'file',
]);

export interface UpsertFormConfigInput {
  institutionTypeId: string;
  /** JSON array of FormFieldDefinition */
  fieldsJson: string;
}

export async function upsertFormConfigurationAction(
  input: UpsertFormConfigInput,
): Promise<ActionState<FormConfiguration>> {
  const institutionTypeId = input.institutionTypeId?.trim() ?? '';
  if (!institutionTypeId) {
    return { status: 'error', message: 'Institution type ID is required.' };
  }

  let fields: FormFieldDefinition[];
  try {
    const parsed: unknown = JSON.parse(input.fieldsJson || '[]');
    if (!Array.isArray(parsed)) {
      return { status: 'error', message: 'Fields must be a JSON array.' };
    }
    fields = parsed.map((raw, index) => {
      const field = raw as Partial<FormFieldDefinition>;
      if (!field.id || !field.label || !field.type) {
        throw new Error(`Field ${index + 1} needs id, label, and type.`);
      }
      if (!FIELD_TYPES.has(field.type as FormFieldType)) {
        throw new Error(`Field ${index + 1} has an invalid type.`);
      }
      return {
        id: String(field.id),
        label: String(field.label),
        type: field.type as FormFieldType,
        required: Boolean(field.required),
        ...(field.options ? { options: field.options } : {}),
        ...(field.validation ? { validation: field.validation } : {}),
      };
    });
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Could not parse fields JSON.',
    };
  }

  try {
    const config = await upsertFormConfiguration({
      institutionTypeId,
      fields,
    });
    revalidatePath('/admin/registration-forms');
    return {
      status: 'success',
      message: 'Form configuration saved.',
      data: config,
    };
  } catch (error) {
    return toErrorState<FormConfiguration>(
      error,
      'Failed to save form configuration',
    );
  }
}
