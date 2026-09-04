/**
 * Server-only Registration Service helpers (uses `gatewayFetch` / next/headers).
 * Client components must import from `./registration` instead.
 */

import { gatewayFetch } from './gateway';
import {
  REGISTRATIONS_GATEWAY_PREFIX,
  buildInstitutionsQuery,
  normalizeTrackingResult,
  type ApplicationTrackingResult,
  type GetApplicationByTrackingNumberResult,
  type InstitutionFilters,
  type InstitutionMapResponse,
  type RegistrationApiResult,
  type RegistrationStatusResponse,
} from './registration';

/**
 * Server-side institution list via `gatewayFetch`.
 * Returns an empty-friendly error when the API is unavailable.
 */
export async function listRegistrationInstitutions(
  filters: InstitutionFilters = {},
): Promise<RegistrationApiResult<InstitutionMapResponse>> {
  const result = await gatewayFetch<InstitutionMapResponse>(
    `${REGISTRATIONS_GATEWAY_PREFIX}/institutions${buildInstitutionsQuery(filters)}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );

  if (!result.ok || !result.data) {
    return {
      kind: 'error',
      message: result.error?.message ?? 'Unable to load schools',
      status: result.status,
    };
  }

  return {
    kind: 'ok',
    data: {
      data: Array.isArray(result.data.data) ? result.data.data : [],
      meta: {
        page: result.data.meta?.page ?? filters.page ?? 1,
        pageSize: result.data.meta?.pageSize ?? filters.pageSize ?? 50,
        totalItems: result.data.meta?.totalItems ?? 0,
        totalPages: result.data.meta?.totalPages ?? 0,
      },
    },
  };
}

/**
 * Server-side status lookup via `gatewayFetch`.
 */
export async function getRegistrationStatus(
  trackingNumber: string,
): Promise<GetApplicationByTrackingNumberResult> {
  const trimmed = trackingNumber.trim();
  if (!trimmed) {
    return { kind: 'error', message: 'Tracking number is required.' };
  }

  const result = await gatewayFetch<
    Partial<ApplicationTrackingResult & RegistrationStatusResponse>
  >(`${REGISTRATIONS_GATEWAY_PREFIX}/${encodeURIComponent(trimmed)}/status`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });

  if (result.status === 404) return { kind: 'not_found' };
  if (!result.ok || !result.data) {
    return {
      kind: 'error',
      message:
        result.error?.message ?? `Request failed with status ${result.status}`,
    };
  }

  return {
    kind: 'ok',
    data: normalizeTrackingResult(result.data, trimmed),
  };
}
