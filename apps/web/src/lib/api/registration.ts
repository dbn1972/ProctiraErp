/**
 * Public Registration API client (anonymous, read-only).
 *
 * Used by the public Application Tracking page to look up the status of a
 * registration application by its tracking number. The endpoint is
 * intentionally unauthenticated (Requirement 16.6 / Task 51.4): an applicant
 * who has the tracking number must be able to check progress without an
 * account.
 *
 * Contract (PRC-H029 — matches `packages/backend/registration/src/routes.ts`, proxied by
 * the gateway under the `/registrations` prefix):
 *   GET /api/v1/registrations/{trackingNumber}/status?dob=YYYY-MM-DD
 *     200 → RegistrationStatusResponse { trackingNumber, status, institutionName,
 *             applicantName, submittedAt, updatedAt, remarks?, waitlistPosition?,
 *             interviewBookings? }
 *     404 → unknown tracking number OR date of birth mismatch (same response, no oracle)
 *     5xx → service error
 *
 * The response intentionally exposes no PII beyond what the applicant
 * submitted (no contact details, no document content, no internal notes).
 */

/** Base URL for the API gateway. Mirrors the server-side gateway client. */
export const REGISTRATION_API_BASE_URL =
  (typeof process !== 'undefined' &&
    (process.env['NEXT_PUBLIC_GATEWAY_URL'] ??
      process.env['NEXT_PUBLIC_REGISTRATION_SERVICE_URL'])) ||
  '';

/** API version + namespace prefix. Concatenated to the base URL. */
export const REGISTRATION_API_PREFIX = '/api/v1/registrations';

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

export type KnownApplicationStatus = (typeof KNOWN_APPLICATION_STATUSES)[number];

/** An interview slot booked against the application (public-safe fields only). */
export interface ApplicationInterviewBooking {
  id: string;
  slotId: string;
  status: string;
}

/** Public-safe application status payload (maps `RegistrationStatusResponse`). */
export interface ApplicationTrackingResult {
  trackingNumber: string;
  status: ApplicationStatus;
  /** Target institution name. */
  institutionName?: string;
  /** ISO-8601 timestamp of original submission. */
  submittedAt: string;
  /** ISO-8601 timestamp of the most recent status change. */
  updatedAt: string;
  /** Reviewer remarks shared with the applicant, when present. */
  remarks?: string;
  /** 1-based waitlist position, when waitlisted. */
  waitlistPosition?: number;
  /** Booked interview slots. May be empty. */
  interviewBookings: ApplicationInterviewBooking[];
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
  dateOfBirth: string,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<GetApplicationByTrackingNumberResult> {
  const trimmed = trackingNumber.trim();
  if (trimmed.length === 0) {
    return {
      kind: 'error',
      message: 'Tracking number is required.',
    };
  }

  // The backend answers 404 for a missing/mismatched DOB, so it is required here.
  const dob = dateOfBirth.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return { kind: 'error', message: 'Date of birth is required (YYYY-MM-DD).' };
  }
  const url =
    `${REGISTRATION_API_BASE_URL}${REGISTRATION_API_PREFIX}/${encodeURIComponent(trimmed)}` +
    `/status?dob=${encodeURIComponent(dob)}`;
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
    const payload = (await response.json()) as RegistrationStatusPayload;
    return { kind: 'ok', data: normalizeTrackingResult(payload, trimmed) };
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Malformed response',
    };
  }
}

/** Wire shape of `RegistrationStatusResponse` (every field treated as untrusted). */
export interface RegistrationStatusPayload {
  trackingNumber?: string;
  status?: string;
  institutionName?: string;
  applicantName?: string;
  submittedAt?: string;
  updatedAt?: string;
  remarks?: string;
  waitlistPosition?: number;
  interviewBookings?: ApplicationInterviewBooking[];
}

/**
 * Maps the backend `RegistrationStatusResponse` onto the UI model, defaulting missing
 * arrays to `[]` so the UI doesn't have to null-check at every site.
 */
export function normalizeTrackingResult(
  payload: RegistrationStatusPayload,
  fallbackTrackingNumber: string,
): ApplicationTrackingResult {
  return {
    trackingNumber: payload.trackingNumber ?? fallbackTrackingNumber,
    status: payload.status ?? 'pending',
    institutionName: payload.institutionName || undefined,
    submittedAt: payload.submittedAt ?? '',
    updatedAt: payload.updatedAt ?? payload.submittedAt ?? '',
    remarks: payload.remarks || undefined,
    waitlistPosition:
      typeof payload.waitlistPosition === 'number' ? payload.waitlistPosition : undefined,
    interviewBookings: Array.isArray(payload.interviewBookings) ? payload.interviewBookings : [],
  };
}

// =============================================================================
// School Finder client (Task 51.3, Requirement 16.9)
// =============================================================================

/**
 * URL prefix for the public School Finder endpoint. The backend route lives
 * at `GET /api/v1/registrations/schools/search` (PRC-H029) (see
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
export function buildSchoolFinderQueryString(input: SchoolFinderQueryInput): string {
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
