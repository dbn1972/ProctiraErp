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

export function safeActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof GatewayError) return error.message || fallback;
  const correlationId = newCorrelationId();
  // eslint-disable-next-line no-console -- server-side log for the correlation id
  console.error(`[server-action] ${fallback} (ref ${correlationId})`, error);
  return `${fallback} (ref ${correlationId.slice(0, 8)})`;
}
