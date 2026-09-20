/** API client for the public registration portal. */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_REGISTRATION_SERVICE_URL ||
  process.env.REGISTRATION_SERVICE_URL ||
  '/api';

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

export async function getFormConfiguration(institutionId: string): Promise<FormConfiguration> {
  const response = await fetch(
    `${API_BASE_URL}/registrations/form-config/${encodeURIComponent(institutionId)}`,
    { cache: 'no-store' },
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
): Promise<InstitutionMapResponse> {
  const params = new URLSearchParams();
  if (filters.areaId) params.set('areaId', filters.areaId);
  if (filters.typeId) params.set('typeId', filters.typeId);
  if (filters.gradeId) params.set('gradeId', filters.gradeId);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const response = await fetch(`${API_BASE_URL}/registrations/institutions?${params.toString()}`, {
    cache: 'no-store',
  });
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
): Promise<RegistrationSubmissionResponse> {
  const response = await fetch(`${API_BASE_URL}/registrations`, {
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
  applicantName: string;
  submittedAt: string;
  updatedAt: string;
  remarks?: string;
}

export async function checkApplicationStatus(
  trackingNumber: string,
  dateOfBirth: string,
): Promise<RegistrationStatus | null> {
  const params = new URLSearchParams({ dob: dateOfBirth });
  const response = await fetch(
    `${API_BASE_URL}/registrations/${encodeURIComponent(trackingNumber)}/status?${params.toString()}`,
    { cache: 'no-store' },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as RegistrationStatus;
}

export async function setSessionLanguage(language: string): Promise<{
  language: string;
  sessionId: string;
}> {
  const response = await fetch(`${API_BASE_URL}/registrations/language`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as { language: string; sessionId: string };
}
