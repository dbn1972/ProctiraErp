/**
 * Custom field definitions client (server-side).
 *
 * Wraps gateway routes under `/custom-fields/definitions`. Gracefully
 * returns empty data when the service is unreachable so admin UI can
 * still render empty states.
 *
 * Backend contract: packages/backend/custom-field
 * (GET /custom-fields/definitions).
 */
import { gatewayFetch } from './gateway';

export type CustomFieldEntityType = 'student' | 'staff' | 'institution';
export type CustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'checkbox'
  | 'textarea'
  | 'file';

export interface CustomFieldDefinition {
  id: string;
  entityType: CustomFieldEntityType;
  fieldKey: string;
  label: string;
  description: string | null;
  fieldType: CustomFieldType;
  validationRules: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    options?: string[];
  } | null;
  displayOrder: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

function unwrapList<T>(payload: { data?: T[] } | T[] | null | undefined): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

export interface ListCustomFieldsOptions {
  entityType?: CustomFieldEntityType;
  isActive?: boolean;
  pageSize?: number;
}

/** Lists custom field definitions; empty when unavailable. */
export async function listCustomFieldDefinitions(
  options: ListCustomFieldsOptions = {},
): Promise<CustomFieldDefinition[]> {
  const params = new URLSearchParams();
  if (options.entityType) params.set('entityType', options.entityType);
  if (typeof options.isActive === 'boolean') {
    params.set('isActive', String(options.isActive));
  }
  params.set('pageSize', String(options.pageSize ?? 100));

  const result = await gatewayFetch<
    { data: CustomFieldDefinition[] } | CustomFieldDefinition[]
  >(`/custom-fields/definitions?${params.toString()}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return unwrapList(result.data);
}
