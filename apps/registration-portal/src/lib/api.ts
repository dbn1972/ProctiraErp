/**
 * API client for the registration portal.
 *
 * Communicates with the backend Registration Service.
 * The base URL is sourced (in priority order) from:
 *   1. NEXT_PUBLIC_REGISTRATION_SERVICE_URL — for client-side fetches
 *   2. REGISTRATION_SERVICE_URL — for Server Components / Server Actions
 *   3. '/api' — same-origin fallback when fronted by an API gateway
 *
 * Endpoints (defined in @proctira/backend-registration):
 *   POST   /registrations
 *   GET    /registrations/:trackingNumber/status
 *   GET    /registrations/institutions
 *   GET    /registrations/form-config/:institutionId
 *   POST   /registrations/language
 *   GET    /registrations/language
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_REGISTRATION_SERVICE_URL ||
  process.env.REGISTRATION_SERVICE_URL ||
  '/api';

// --- Shared error handling -----------------------------------------------

/** Field-level validation error returned by the backend */
export interface FieldError {
  field: string;
  message: string;
  rule?: string;
}

/** Backend error response */
export interface ApiError {
  code?: string;
  message: string;
  statusCode: number;
  errors?: FieldError[];
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    return {
      code: body.code,
      message: body.message ?? 'Request failed',
      statusCode: body.statusCode ?? response.status,
      errors: body.errors,
    };
  } catch {
    return { message: response.statusText, statusCode: response.status };
  }
}

// --- Form configuration ---------------------------------------------------

/** A configurable field definition for the registration form */
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

/** Form configuration for an institution / institution type */
export interface FormConfiguration {
  institutionTypeId: string;
  fields: FormFieldDefinition[];
}

/**
 * Fetches the form configuration for a given institution.
 * Returns an empty configuration if none is defined for the institution.
 */
export async function getFormConfiguration(
  institutionId: string,
): Promise<FormConfiguration> {
  const response = await fetch(
    `${API_BASE_URL}/registrations/form-config/${encodeURIComponent(institutionId)}`,
    { cache: 'no-store' },
  );
  if (!response.ok) {
    throw new Error((await parseError(response)).message);
  }
  return (await response.json()) as FormConfiguration;
}

// --- Institution map ------------------------------------------------------

/** Filter options for the institution list / map */
export interface InstitutionFilters {
  areaId?: string;
  typeId?: string;
  gradeId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

/** Institution location entry (matches backend InstitutionLocation schema) */
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

/** Paginated institution map response */
export interface InstitutionMapResponse {
  data: InstitutionLocation[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/**
 * Fetches institutions for the school finder map, with optional filtering.
 */
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

  const response = await fetch(
    `${API_BASE_URL}/registrations/institutions?${params.toString()}`,
    { cache: 'no-store' },
  );
  if (!response.ok) {
    throw new Error((await parseError(response)).message);
  }
  return (await response.json()) as InstitutionMapResponse;
}

// --- Submission -----------------------------------------------------------

/** Configurable field value sent on submission */
export interface RegistrationFieldValue {
  fieldId: string;
  value: string | number | boolean | null;
}

/** Document metadata sent on submission (multipart upload uses a separate flow) */
export interface DocumentUploadMetadata {
  fileName: string;
  fileType: string;
  fileSize: number;
  documentType: string;
  /** Base64-encoded content; multipart upload should be preferred for large files */
  content?: string;
}

/** Registration submission payload (matches backend SubmitRegistrationSchema) */
export interface RegistrationSubmissionInput {
  institutionId: string;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other';
  guardianName: string;
  guardianPhone: string;
  guardianEmail?: string;
  customFields?: RegistrationFieldValue[];
  documents?: DocumentUploadMetadata[];
  preferredLanguage?: string;
}

/** Submission response with tracking number */
export interface RegistrationSubmissionResponse {
  id: string;
  trackingNumber: string;
  status: string;
  institutionId: string;
  submittedAt: string;
  message: string;
}

/**
 * Submits a new registration application.
 * On success the response includes the tracking number used to look up status.
 */
export async function submitRegistration(
  payload: RegistrationSubmissionInput,
): Promise<RegistrationSubmissionResponse> {
  const response = await fetch(`${API_BASE_URL}/registrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error((await parseError(response)).message);
  }
  return (await response.json()) as RegistrationSubmissionResponse;
}

// --- Status check --------------------------------------------------------

/** Application status (matches backend RegistrationStatusResponse) */
export interface RegistrationStatus {
  trackingNumber: string;
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'waitlisted';
  institutionName: string;
  applicantName: string;
  submittedAt: string;
  updatedAt: string;
  remarks?: string;
}

/**
 * Looks up an application status by tracking number.
 * Returns `null` if no application is found.
 */
export async function checkApplicationStatus(
  trackingNumber: string,
): Promise<RegistrationStatus | null> {
  const response = await fetch(
    `${API_BASE_URL}/registrations/${encodeURIComponent(trackingNumber)}/status`,
    { cache: 'no-store' },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error((await parseError(response)).message);
  }

  return (await response.json()) as RegistrationStatus;
}

// --- Language -------------------------------------------------------------

/**
 * Persists the selected language in the backend session.
 * Returns the session id (also set in the `x-session-id` response header).
 */
export async function setSessionLanguage(language: string): Promise<{
  language: string;
  sessionId: string;
}> {
  const response = await fetch(`${API_BASE_URL}/registrations/language`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  if (!response.ok) {
    throw new Error((await parseError(response)).message);
  }
  return (await response.json()) as { language: string; sessionId: string };
}
