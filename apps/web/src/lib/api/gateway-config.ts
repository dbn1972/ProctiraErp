/**
 * Client-safe gateway URL constants.
 *
 * Keep `next/headers` out of this module so Client Components can import
 * base URL / API prefix without pulling the server-only gateway client.
 */

/** Base URL for the API gateway. Can be overridden via env. */
export const GATEWAY_BASE_URL =
  process.env['NEXT_PUBLIC_GATEWAY_URL'] ??
  process.env['GATEWAY_URL'] ??
  'http://localhost:3000';

/** API version prefix used by the gateway. */
export const GATEWAY_API_PREFIX = '/api/v1';
