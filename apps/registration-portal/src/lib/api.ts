/** API client for the public registration portal. */

/** Request shape shared by the browser and server transports. */
export interface RegistrationRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Sends `path` (relative to the gateway `/api/v1`, e.g. `/registrations/...`).
 * Server code passes `serverTransport` from `lib/gateway`; the default is the
 * browser transport through the portal's same-origin proxy.
 */
export type RegistrationTransport = (
  path: string,
  init?: RegistrationRequestInit,
) => Promise<Response>;

/** Browser transport: same-origin `/api/registrations/*` proxy route. */
export const browserTransport: RegistrationTransport = (path, init = {}) => {
  if (typeof window === 'undefined') {
    throw new Error(
      'Server-side registration API calls must pass serverTransport from lib/gateway',
    );
  }
  return fetch(`/api${path}`, { ...init, cache: 'no-store' });
};

export interface FieldError {
  field: string;
  message: string;
  rule?: string;
}

export interface ApiError {
  code?: string;
  message: string;
  statusCode: number;
  errors?: FieldError[];
}

/** Typed backend failure so callers can distinguish absent data from outages. */
export class RegistrationApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string,
    readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = 'RegistrationApiError';
  }
}

async function parseError(response: Response): Promise<RegistrationApiError> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    return new RegistrationApiError(
      body.message ?? 'Request failed',
      body.statusCode ?? response.status,
      body.code,
      body.errors ?? [],
    );
  } catch {
    return new RegistrationApiError(
      response.statusText || 'Request failed',
      response.status,
      undefined,
      [],
    );
  }
}

export interface FormFieldDefinition {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea' | 'file';
  required: boolean;
  options?: { value: string; label: string }[];
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

/** One immutable published form version for a concrete institution UUID. */
export interface FormConfiguration {
  id: string;
  institutionId: string;
  version: number;
  publishedAt: string;
  fields: FormFieldDefinition[];
}

export async function getFormConfiguration(
  institutionId: string,
  transport: RegistrationTransport = browserTransport,
): Promise<FormConfiguration> {
  const response = await transport(
    `/registrations/form-config/${encodeURIComponent(institutionId)}`,
  );
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as FormConfiguration;
}

export interface InstitutionFilters {
  areaId?: string;
  typeId?: string;
  gradeId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface InstitutionLocation {
  id: string;
  name: string;
  code: string;
  typeId: string;
  typeName?: string;
  areaId: string;
  areaName?: string;
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  availableGrades?: string[];
}

export interface InstitutionMapResponse {
  data: InstitutionLocation[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export async function getInstitutions(
  filters: InstitutionFilters = {},
  transport: RegistrationTransport = browserTransport,
): Promise<InstitutionMapResponse> {
  const params = new URLSearchParams();
  if (filters.areaId) params.set('areaId', filters.areaId);
  if (filters.typeId) params.set('typeId', filters.typeId);
  if (filters.gradeId) params.set('gradeId', filters.gradeId);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const response = await transport(`/registrations/institutions?${params.toString()}`);
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as InstitutionMapResponse;
}

export interface RegistrationFieldValue {
  fieldId: string;
  value: string | number | boolean | null;
}

export interface DocumentUploadMetadata {
  fileName: string;
  fileType: string;
  fileSize: number;
  documentType: string;
  content?: string;
}

export interface RegistrationSubmissionInput {
  institutionId: string;
  formConfigurationId: string;
  formConfigurationVersion: number;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other';
  guardianName: string;
  guardianPhone: string;
  guardianEmail?: string;
  customFields?: RegistrationFieldValue[];
  documents?: DocumentUploadMetadata[];
  preferredLanguage?: string;
}

export interface RegistrationSubmissionResponse {
  id: string;
  trackingNumber: string;
  status: string;
  institutionId: string;
  submittedAt: string;
  message: string;
}

export async function submitRegistration(
  payload: RegistrationSubmissionInput,
  submissionKey: string,
  transport: RegistrationTransport = browserTransport,
): Promise<RegistrationSubmissionResponse> {
  const response = await transport('/registrations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': submissionKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as RegistrationSubmissionResponse;
}

export interface RegistrationStatus {
  trackingNumber: string;
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'waitlisted';
  institutionName: string;
  /** First-name initial only (PRC-M331). */
  applicantName: string;
  submittedAt: string;
  updatedAt: string;
}

export async function checkApplicationStatus(
  trackingNumber: string,
  dateOfBirth: string,
  transport: RegistrationTransport = browserTransport,
): Promise<RegistrationStatus | null> {
  // PRC-M331: DOB travels in the POST body, never in the URL / access logs.
  const response = await transport('/registrations/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackingNumber, dateOfBirth }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as RegistrationStatus;
}

export async function setSessionLanguage(
  language: string,
  transport: RegistrationTransport = browserTransport,
): Promise<{
  language: string;
  sessionId: string;
}> {
  const response = await transport('/registrations/language', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as { language: string; sessionId: string };
}
