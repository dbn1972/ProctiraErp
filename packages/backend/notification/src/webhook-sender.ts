/**
 * Real webhook notification sender (g7_platform-002).
 *
 * Unlike email/push/SMS (which currently have only sandbox adapters), a webhook is a plain HTTPS
 * POST the platform can genuinely perform. This sender:
 *   - POSTs the payload through the shared SSRF guard (safeFetch): https-only, private/loopback/
 *     link-local/metadata/CGNAT (incl. IPv6) blocked, redirects re-validated, timeout + size cap;
 *   - reports success ONLY on a 2xx response — a non-2xx, an SSRF rejection, or any transport
 *     error is reported as failure so the notification is never falsely marked 'delivered'.
 */
import { safeFetch, SsrfError } from '@proctira/common/safe-fetch';

import type { WebhookSender } from './notification-service.js';

export interface SafeFetchWebhookSenderDeps {
  /** Injectable for tests; defaults to the shared SSRF-safe fetch. */
  fetchImpl?: typeof safeFetch;
}

export function createSafeFetchWebhookSender(deps: SafeFetchWebhookSenderDeps = {}): WebhookSender {
  const doFetch = deps.fetchImpl ?? safeFetch;
  return {
    async send(params: { url: string; payload: Record<string, unknown>; tenantId: string }) {
      try {
        const res = await doFetch(params.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params.payload),
        });
        const ok = res.status >= 200 && res.status < 300;
        return ok
          ? { success: true, statusCode: res.status }
          : { success: false, statusCode: res.status, error: `Webhook responded ${res.status}` };
      } catch (err) {
        const message =
          err instanceof SsrfError
            ? `Webhook URL rejected: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Webhook delivery failed';
        return { success: false, error: message };
      }
    },
  };
}

/**
 * Factory used by the plugin: a webhook is a real channel, so the default sender is always the
 * live SSRF-safe sender (there is no "sandbox" webhook — it either reaches a public URL or fails).
 */
export function createWebhookSenderFromEnv(): WebhookSender {
  return createSafeFetchWebhookSender();
}
