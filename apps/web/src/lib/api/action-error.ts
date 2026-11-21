/**
 * User-safe error text for server actions (PRC-L250).
 *
 * GatewayError messages come from the gateway's error envelope and are meant
 * for users. Any other Error (TypeError 'fetch failed http://internal…', zod,
 * programming errors) may carry internal detail, so the browser only gets the
 * fallback plus a correlation id; the full error is logged server-side.
 */
import { GatewayError } from './gateway';

export function newCorrelationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}`;
}

/** Same rule as the parent academic frame (D1b): only a plain token is shown. */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9-]{8,64}$/;

export const PERMISSION_DENIED_ACTION_MESSAGE =
  'You do not have permission to make this change. Contact your administrator if you need access.';

export const CONFLICT_ACTION_MESSAGE =
  'This conflicts with an existing record. Check the details and try again.';

/**
 * T-D3: user-safe text for server actions that must never show server text,
 * not even a GatewayError message (the gateway's RBAC refusal names internal
 * resources and actions). 401/403 get fixed permission copy, 409 fixed
 * conflict copy, anything else the caller's fallback. The gateway correlation id is appended when it is a plain
 * token, otherwise a local one; the full error is logged server-side.
 */
export function genericActionErrorMessage(error: unknown, fallback: string): string {
  const gatewayId = error instanceof GatewayError ? error.correlationId : undefined;
  const reference =
    gatewayId && SAFE_CORRELATION_ID.test(gatewayId) ? gatewayId : newCorrelationId().slice(0, 8);
  const status = error instanceof GatewayError ? error.status : undefined;
  const text =
    status === 401 || status === 403
      ? PERMISSION_DENIED_ACTION_MESSAGE
      : status === 409
        ? CONFLICT_ACTION_MESSAGE
        : fallback;
  // eslint-disable-next-line no-console -- server-side log for the correlation id
  console.error(`[server-action] ${fallback} (ref ${reference})`, error);
  return `${text} (ref ${reference})`;
}

export function safeActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof GatewayError) return error.message || fallback;
  const correlationId = newCorrelationId();
  // eslint-disable-next-line no-console -- server-side log for the correlation id
  console.error(`[server-action] ${fallback} (ref ${correlationId})`, error);
  return `${fallback} (ref ${correlationId.slice(0, 8)})`;
}
