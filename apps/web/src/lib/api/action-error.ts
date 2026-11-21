/**
 * User-safe error text for server actions (PRC-L250, T-D3, RAW-WEB).
 *
 * No server text reaches the browser: neither a non-gateway Error (TypeError
 * 'fetch failed http://internal…', zod, programming errors) nor a GatewayError
 * message (RBAC refusals name internal resources; older gateways sent raw
 * database text). The browser gets fixed copy plus a correlation id; the full
 * error is logged server-side. RAW-WEB removed `safeActionErrorMessage`, which
 * still forwarded GatewayError messages.
 */
import { GatewayError, type GatewayResponse } from './gateway';

export function newCorrelationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}`;
}

/**
 * The one rule for a gateway correlation id shown to users (D1b): only a plain token. Shared by
 * server actions and the parent/student academic frame (`parent-portal.ts`, T-D3-R4).
 */
export const SAFE_CORRELATION_ID = /^[A-Za-z0-9-]{8,64}$/;

export const PERMISSION_DENIED_ACTION_MESSAGE =
  'You do not have permission to make this change. Contact your administrator if you need access.';

export const CONFLICT_ACTION_MESSAGE =
  'This conflicts with an existing record. Check the details and try again.';

/** RAW-WEB: fixed copy for 413 so upload forms keep an actionable message. */
export const PAYLOAD_TOO_LARGE_ACTION_MESSAGE =
  'The file is larger than this form accepts. Upload a smaller file.';

/**
 * T-D3: user-safe text for server actions that must never show server text,
 * not even a GatewayError message (the gateway's RBAC refusal names internal
 * resources and actions). 401/403 get fixed permission copy, 409 fixed
 * conflict copy, 413 fixed file-size copy (RAW-WEB), anything else the caller's fallback. The gateway correlation id is appended when it is a plain
 * token, otherwise a local one; the full error is logged server-side.
 */
export function genericActionErrorMessage(
  error: unknown,
  fallback: string,
  copy: { conflict?: string } = {},
): string {
  const gatewayId = error instanceof GatewayError ? error.correlationId : undefined;
  const reference =
    gatewayId && SAFE_CORRELATION_ID.test(gatewayId) ? gatewayId : newCorrelationId().slice(0, 8);
  const status = error instanceof GatewayError ? error.status : undefined;
  const text =
    status === 401 || status === 403
      ? PERMISSION_DENIED_ACTION_MESSAGE
      : status === 409
        ? (copy.conflict ?? CONFLICT_ACTION_MESSAGE)
        : status === 413
          ? PAYLOAD_TOO_LARGE_ACTION_MESSAGE
          : fallback;
  // eslint-disable-next-line no-console -- server-side log for the correlation id
  console.error(`[server-action] ${fallback} (ref ${reference})`, error);
  return `${text} (ref ${reference})`;
}

/**
 * RAW-WEB: same rule for a `gatewayFetch(..., { throwOnError: false })` failure: status-based
 * fixed copy plus the gateway correlation id; `result.error.message` is never shown.
 */
export function genericResultErrorMessage(
  result: Pick<GatewayResponse<unknown>, 'status' | 'error' | 'correlationId'>,
  fallback: string,
): string {
  return genericActionErrorMessage(
    new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'GATEWAY_ERROR',
      // Logged server-side only; never part of the returned text.
      message: result.error?.message ?? fallback,
      ...(result.error ? { details: result.error } : {}),
      ...(result.correlationId ? { correlationId: result.correlationId } : {}),
    }),
    fallback,
  );
}
