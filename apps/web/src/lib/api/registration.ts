/**
 * Public Registration API client.
 *
 * Talks to the Prisma-backed Registration Service via the API gateway:
 *   POST /api/v1/registrations
 *   GET  /api/v1/registrations/:trackingNumber/status
 *   GET  /api/v1/registrations/institutions
 *   GET  /api/v1/registrations/schools/search
 *   GET  /api/v1/registrations/form-config/:institutionId
 *
 * Tracking and school search are anonymous (Requirement 16.6 / 16.9).
 * Browser-safe: no `next/headers`. Server Components that need
 * `gatewayFetch` should import from `./registration.server`.
 */

import {
  browserGatewayFetch,
  BrowserGatewayError,
} from './browser-gateway';

/** Base URL for the API gateway. Mirrors the server-side gateway client. */
export const REGISTRATION_API_BASE_URL =
  (typeof process !== 'undefined' &&
    (process.env['NEXT_PUBLIC_GATEWAY_URL'] ??
      process.env['NEXT_PUBLIC_REGISTRATION_SERVICE_URL'])) ||
  '';

/**
 * Public status lookup path (gateway-mounted Registration Service).
 * Full URL = `${REGISTRATION_API_BASE_URL}${REGISTRATION_API_PREFIX}/{tn}/status`
 */
export const REGISTRATION_API_PREFIX = '/api/v1/registrations';

/** Gateway-relative prefix used by `gatewayFetch` / `browserGatewayFetch`. */
export const REGISTRATIONS_GATEWAY_PREFIX = '/registrations';

/**
 * Possible application statuses surfaced on the public tracking page.
 * These mirror the server-side enum but the client treats unknown values as
 * "unknown" rather than crashing — schema drift between this client and a
 * deployed backend is a "show what we know" situation, not a hard error.
 *
 * The type is intentionally `string` so consumers can pattern-match the
 * known codes (`pending`, `under_review`, `approved`, `rejected`,
 * `waitlisted`) while still accepting future values without a recompile.
 */
export type ApplicationStatus = string;

/** The set of status codes the UI knows how to label and color. */
export const KNOWN_APPLICATION_STATUSES = [
  'pending',
  'under_review',
  'approved',
  'rejected',
  'waitlisted',
] as const;

export type KnownApplicationStatus =
  (typeof KNOWN_APPLICATION_STATUSES)[number];

/** A single status transition recorded against the application. */
export interface ApplicationStatusHistoryEntry {
  /** Status the application moved to at this point in time. */
  status: ApplicationStatus;
  /** ISO-8601 timestamp of the transition. */
  timestamp: string;
  /** Optional public-safe note (e.g. "Documents verified"). */
  note?: string;
  /** Optional actor label (e.g. "System", "Admissions Office"). No user IDs. */
  actor?: string;
}

/**
 * A follow-up action the applicant must take. The backend uses an
 * unauthenticated dialect so labels are pre-translated server-side or
 * looked up from a known catalog of action codes — the client only renders
 * the message it receives.
 */
export interface ApplicationFollowUpAction {
  /** Stable code (e.g. `UPLOAD_BIRTH_CERTIFICATE`); useful for analytics. */
  code: string;
  /** User-visible message describing the action. */
  message: string;
  /** Optional ISO-8601 deadline. */
  dueAt?: string;
}

/** Public-safe application status payload. */
export interface ApplicationTrackingResult {
  trackingNumber: string;
  status: ApplicationStatus;
  /** Optional human-readable step name (e.g. "Document review"). */
  currentStep?: string;
  /** ISO-8601 timestamp of original submission. */
  submittedAt: string;
  /** ISO-8601 timestamp of the most recent status change. */
  updatedAt: string;
  /** ISO-8601 expected completion target, when known. */
  expectedCompletionAt?: string;
  /** Chronological status history (oldest → newest). */
  history: ApplicationStatusHistoryEntry[];
  /** Outstanding follow-up actions for the applicant. May be empty. */
  followUpActions: ApplicationFollowUpAction[];
}

/** Discriminated result union the page consumes. */
export type GetApplicationByTrackingNumberResult =
  | { kind: 'ok'; data: ApplicationTrackingResult }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

/**
 * Looks up an application by tracking number.
 *
 * Returns a tagged union so the page can branch on `kind` without using
 * thrown exceptions for control flow. Network failures and 5xx responses
 * are reported as `kind: 'error'`; an explicit 404 is `kind: 'not_found'`
 * so the page can show the friendly empty state.
 */
export async function getApplicationByTrackingNumber(
  trackingNumber: string,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<GetApplicationByTrackingNumberResult> {
  const trimmed = trackingNumber.trim();
  if (trimmed.length === 0) {
    return {
      kind: 'error',
      message: 'Tracking number is required.',
    };
  }

  const url = `${REGISTRATION_API_BASE_URL}${REGISTRATION_API_PREFIX}/${encodeURIComponent(trimmed)}/status`;
  const fetcher = options.fetcher ?? fetch;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      // The caller cancelled; surface as a benign error so the UI can
      // simply ignore the result instead of rendering an error state.
      return { kind: 'error', message: 'aborted' };
    }
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  if (response.status === 404) {
    return { kind: 'not_found' };
  }

  if (!response.ok) {
    return {
      kind: 'error',
      message: `Request failed with status ${response.status}`,
    };
  }

  try {
    const payload = (await response.json()) as Partial<
      ApplicationTrackingResult & RegistrationStatusResponse
    >;
    return { kind: 'ok', data: normalizeTrackingResult(payload, trimmed) };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Malformed response',
    };
  }
}

/**
 * Backend status payload from `GET /registrations/:trackingNumber/status`.
 * Mapped into the richer public tracking view shape below.
 */
export interface RegistrationStatusResponse {
  trackingNumber: string;
  status: ApplicationStatus;
  institutionName: string;
  applicantName: string;
  submittedAt: string;
  updatedAt: string;
  remarks?: string;
}

/**
 * Coerces a partial server payload into the strict client shape, defaulting
 * missing arrays to `[]` so the UI doesn't have to null-check at every site.
 * Accepts both the rich tracking dialect and the lean Registration Service
 * status response (`institutionName` / `applicantName` / `remarks`).
 */
export function normalizeTrackingResult(
  payload: Partial<ApplicationTrackingResult & RegistrationStatusResponse>,
  fallbackTrackingNumber: string,
): ApplicationTrackingResult {
  const history = Array.isArray(payload.history)
    ? payload.history
    : synthesizeHistoryFromStatus(payload);

  const currentStep =
    payload.currentStep ??
    (payload.institutionName
      ? `${payload.applicantName ?? 'Applicant'} · ${payload.institutionName}`
      : undefined);

  const followUpActions = Array.isArray(payload.followUpActions)
    ? payload.followUpActions
    : payload.remarks
      ? [{ code: 'REMARKS', message: payload.remarks }]
      : [];

  return {
    trackingNumber: payload.trackingNumber ?? fallbackTrackingNumber,
    status: payload.status ?? 'pending',
    currentStep,
    submittedAt: payload.submittedAt ?? '',
    updatedAt: payload.updatedAt ?? payload.submittedAt ?? '',
    expectedCompletionAt: payload.expectedCompletionAt,
    history,
    followUpActions,
  };
}

function synthesizeHistoryFromStatus(
  payload: Partial<ApplicationTrackingResult & RegistrationStatusResponse>,
): ApplicationStatusHistoryEntry[] {
  // Only synthesize when the lean Registration Service dialect is present
  // (`institutionName`). Rich tracking payloads without a history array
  // stay empty rather than inventing transitions.
  if (!payload.institutionName || !payload.status) return [];
  const entries: ApplicationStatusHistoryEntry[] = [];
  if (payload.submittedAt) {
    entries.push({
      status: 'pending',
      timestamp: payload.submittedAt,
      note: 'Application submitted',
      actor: 'System',
    });
  }
  if (payload.status !== 'pending' && payload.updatedAt) {
    entries.push({
      status: payload.status,
      timestamp: payload.updatedAt,
      note: payload.remarks,
      actor: 'Admissions Office',
    });
  }
  return entries;
}


// =============================================================================
// School Finder client (Task 51.3, Requirement 16.9)
// =============================================================================

/**
 * URL prefix for the public School Finder endpoint. The backend route lives
 * at `GET /api/v1/registrations/schools/search` (see
 * `packages/backend/registration/src/routes.ts`). Like the tracking endpoint
 * above, this is anonymous-accessible.
 */
export const SCHOOL_FINDER_API_PREFIX = '/api/v1/registrations/schools/search';

/**
 * Filters accepted by the School Finder. The geolocation triple
 * (`latitude`, `longitude`, `radiusKm`) is all-or-nothing: providing any one
 * without the other two surfaces as a 400 from the backend's cross-field
 * guard. The component only sets all three together.
 */
export interface SchoolFinderQueryInput {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  areaIds?: string[];
  schoolTypes?: string[];
  gradeLevels?: string[];
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * One school returned by the search. `distanceKm` is only populated when the
 * query carried the geolocation triple.
 */
export interface SchoolFinderResult {
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
  distanceKm?: number;
}

/** Pagination metadata mirroring the backend response shape. */
export interface SchoolFinderMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  origin?: { latitude: number; longitude: number; radiusKm: number };
}

export interface SchoolFinderResponse {
  data: SchoolFinderResult[];
  meta: SchoolFinderMeta;
}

/** Discriminated union the component consumes. */
export type SchoolFinderSearchResult =
  | { kind: 'ok'; data: SchoolFinderResult[]; meta: SchoolFinderMeta }
  | { kind: 'error'; message: string };

/**
 * Build the query string for the School Finder. Lists are serialised as
 * comma-separated values to keep URLs short while still matching the backend
 * parser, which accepts both the comma form and repeated parameters.
 */
export function buildSchoolFinderQueryString(
  input: SchoolFinderQueryInput,
): string {
  const params = new URLSearchParams();

  if (
    typeof input.latitude === 'number' &&
    typeof input.longitude === 'number' &&
    typeof input.radiusKm === 'number'
  ) {
    params.set('latitude', String(input.latitude));
    params.set('longitude', String(input.longitude));
    params.set('radiusKm', String(input.radiusKm));
  }

  const setList = (key: string, values: string[] | undefined): void => {
    if (!values || values.length === 0) return;
    params.set(key, values.join(','));
  };

  setList('areaIds', input.areaIds);
  setList('schoolTypes', input.schoolTypes);
  setList('gradeLevels', input.gradeLevels);

  if (typeof input.search === 'string' && input.search.trim().length > 0) {
    params.set('search', input.search.trim());
  }
  if (typeof input.page === 'number') params.set('page', String(input.page));
  if (typeof input.pageSize === 'number') {
    params.set('pageSize', String(input.pageSize));
  }

  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

/**
 * Search institutions using the public School Finder API. Returns a tagged
 * union so the caller can branch on `kind` without throwing for control
 * flow. A 400 from the cross-field guard surfaces as `kind: 'error'` with
 * the server-supplied message; network failures fall through with the
 * underlying error message.
 */
export async function searchSchools(
  input: SchoolFinderQueryInput,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<SchoolFinderSearchResult> {
  const url = `${REGISTRATION_API_BASE_URL}${SCHOOL_FINDER_API_PREFIX}${buildSchoolFinderQueryString(input)}`;
  const fetcher = options.fetcher ?? fetch;

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      return { kind: 'error', message: 'aborted' };
    }
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body?.message === 'string' && body.message.length > 0) {
        message = body.message;
      }
    } catch {
      // Fallthrough — keep the default status-derived message.
    }
    return { kind: 'error', message };
  }

  try {
    const payload = (await response.json()) as Partial<SchoolFinderResponse>;
    return {
      kind: 'ok',
      data: Array.isArray(payload.data) ? payload.data : [],
      meta: {
        page: payload.meta?.page ?? input.page ?? 1,
        pageSize: payload.meta?.pageSize ?? input.pageSize ?? 20,
        totalItems: payload.meta?.totalItems ?? 0,
        totalPages: payload.meta?.totalPages ?? 0,
        ...(payload.meta?.origin ? { origin: payload.meta.origin } : {}),
      },
    };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Malformed response',
    };
  }
}


// =============================================================================
// Gateway-backed Registration Service (submit + institutions + form config)
// =============================================================================

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

export interface RegistrationSubmissionResponse {
  id: string;
  trackingNumber: string;
  status: string;
  institutionId: string;
  submittedAt: string;
  message: string;
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

export interface InstitutionFilters {
  areaId?: string;
  typeId?: string;
  gradeId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export type RegistrationApiResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'error'; message: string; status?: number };

export function buildInstitutionsQuery(filters: InstitutionFilters): string {
  const params = new URLSearchParams();
  if (filters.areaId) params.set('areaId', filters.areaId);
  if (filters.typeId) params.set('typeId', filters.typeId);
  if (filters.gradeId) params.set('gradeId', filters.gradeId);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

/**
 * Browser-side submission against `POST /registrations`.
 * Returns a tagged union so the wizard can render empty/error states.
 */
export async function submitRegistration(
  payload: RegistrationSubmissionInput,
  options: { tenantId?: string; signal?: AbortSignal } = {},
): Promise<RegistrationApiResult<RegistrationSubmissionResponse>> {
  try {
    const data = await browserGatewayFetch<RegistrationSubmissionResponse>(
      REGISTRATIONS_GATEWAY_PREFIX,
      {
        method: 'POST',
        json: payload,
        tenantId: options.tenantId ?? 'default',
        signal: options.signal,
      },
    );
    return { kind: 'ok', data };
  } catch (err) {
    if (err instanceof BrowserGatewayError) {
      return { kind: 'error', message: err.message, status: err.status };
    }
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * Browser-side institution list (client school finder refresh).
 */
export async function fetchRegistrationInstitutions(
  filters: InstitutionFilters = {},
  options: { tenantId?: string; signal?: AbortSignal } = {},
): Promise<RegistrationApiResult<InstitutionMapResponse>> {
  try {
    const data = await browserGatewayFetch<InstitutionMapResponse>(
      `${REGISTRATIONS_GATEWAY_PREFIX}/institutions${buildInstitutionsQuery(filters)}`,
      {
        method: 'GET',
        tenantId: options.tenantId ?? 'default',
        signal: options.signal,
      },
    );
    return {
      kind: 'ok',
      data: {
        data: Array.isArray(data.data) ? data.data : [],
        meta: {
          page: data.meta?.page ?? filters.page ?? 1,
          pageSize: data.meta?.pageSize ?? filters.pageSize ?? 50,
          totalItems: data.meta?.totalItems ?? 0,
          totalPages: data.meta?.totalPages ?? 0,
        },
      },
    };
  } catch (err) {
    if (err instanceof BrowserGatewayError) {
      return { kind: 'error', message: err.message, status: err.status };
    }
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }
}
