/**
 * Sandbox SMS sender — accepts messages without calling a carrier.
 * Wire Twilio (or equivalent) behind SmsSender for production delivery.
 */
import type { SmsSender } from './notification-service.js';

export const SMS_SANDBOX_HONESTY_NOTE =
  'Sandbox SMS — preference toggles and sends are accepted without calling a carrier. Wire Twilio (or equivalent) credentials for production delivery.';

export function createSandboxSmsSender(): SmsSender {
  return {
    async send(params) {
      return {
        success: true,
        messageId: `sandbox-sms:${params.tenantId}:${params.to}`,
        mode: 'sandbox',
        honestyNote: SMS_SANDBOX_HONESTY_NOTE,
      };
    },
  };
}
