/**
 * Registration form-configuration helpers (server-side).
 *
 *   GET /api/v1/registrations/form-configs
 *   PUT /api/v1/registrations/form-config
 *   GET /api/v1/registrations/form-config/:institutionId
 */
import { gatewayFetch } from './gateway';
import { REGISTRATIONS_GATEWAY_PREFIX } from './registration';

export type FormFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'textarea'
  | 'file';

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormFieldDefinition {
  id: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: FormFieldOption[];
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface FormConfiguration {
  institutionTypeId: string;
  fields: FormFieldDefinition[];
}

export async function listFormConfigurations(): Promise<FormConfiguration[]> {
  const result = await gatewayFetch<{ data: FormConfiguration[] }>(
    `${REGISTRATIONS_GATEWAY_PREFIX}/form-configs`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  if (!result.ok || !result.data) return [];
  return Array.isArray(result.data.data) ? result.data.data : [];
}

export async function getFormConfiguration(
  institutionId: string,
): Promise<FormConfiguration | null> {
  const result = await gatewayFetch<FormConfiguration>(
    `${REGISTRATIONS_GATEWAY_PREFIX}/form-config/${encodeURIComponent(institutionId)}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  if (!result.ok || !result.data) return null;
  return result.data;
}

export async function upsertFormConfiguration(
  config: FormConfiguration,
): Promise<FormConfiguration> {
  const result = await gatewayFetch<FormConfiguration>(
    `${REGISTRATIONS_GATEWAY_PREFIX}/form-config`,
    { method: 'PUT', json: config },
  );
  if (!result.data) {
    throw new Error('Empty response from form-config API');
  }
  return result.data;
}
