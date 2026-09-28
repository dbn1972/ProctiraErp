/**
 * How a failed institution read should be shown. statusCode 0 is the
 * gateway/network failure from ApiClientError — never a live Active school.
 */
export type InstitutionLoadFailure = 'not-found' | 'gateway-down' | 'unexpected';

export function classifyInstitutionLoadError(
  error: { statusCode?: number } | null | undefined,
): InstitutionLoadFailure {
  if (error?.statusCode === 404) return 'not-found';
  if (error?.statusCode === 0) return 'gateway-down';
  return 'unexpected';
}

/** OpenStreetMap link for a validated coordinate pair. Empty when either value is unusable. */
export function coordinateMapPreview(latitude: unknown, longitude: unknown): string | null {
  if (latitude === '' || latitude === null || latitude === undefined) return null;
  if (longitude === '' || longitude === null || longitude === undefined) return null;
  const lat = typeof latitude === 'number' ? latitude : Number(latitude);
  const lng = typeof longitude === 'number' ? longitude : Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}
