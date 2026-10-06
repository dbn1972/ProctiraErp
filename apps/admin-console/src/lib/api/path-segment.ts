/**
 * PRC-M001: identifiers and verbs that become gateway URL path segments.
 *
 * Server actions read these from untrusted form data. A value such as
 * `../../plugins/plg_001/approve` would otherwise be normalised by fetch into a
 * different role area's endpoint, so every segment is validated and encoded.
 */
import { z } from 'zod';

/** Opaque resource id: tenant/plugin/theme/plan/break-glass ids (uuid, slug, `tnt_001`). */
export const RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Zod schema for a resource id read from form data. */
export const resourceIdSchema = z.string().regex(RESOURCE_ID_PATTERN, 'Invalid identifier.');

export class InvalidPathSegmentError extends Error {
  constructor(value: string) {
    super(`Invalid gateway path segment: ${JSON.stringify(value.slice(0, 80))}`);
    this.name = 'InvalidPathSegmentError';
  }
}

/**
 * Validate and encode a single path segment. Throws instead of returning a
 * best-effort value so a bad id can never reach `fetch`.
 */
export function pathSegment(value: string): string {
  if (!RESOURCE_ID_PATTERN.test(value)) throw new InvalidPathSegmentError(value);
  return encodeURIComponent(value);
}

/** Validate that a verb segment is one of the allowed literals, then encode it. */
export function verbSegment<T extends string>(value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) throw new InvalidPathSegmentError(value);
  return encodeURIComponent(value) as T;
}
