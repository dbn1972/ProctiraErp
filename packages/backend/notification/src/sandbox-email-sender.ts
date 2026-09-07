/**
 * Sandbox email sender — accepts messages without calling SMTP.
 * Wire SMTP/SendGrid (or equivalent) behind EmailSender for production delivery.
 */
import type { EmailSender } from './notification-service.js';

export const EMAIL_SANDBOX_HONESTY_NOTE =
  'Sandbox email — preference toggles and sends are accepted without calling SMTP. Wire SMTP/SendGrid (or equivalent) credentials for production delivery.';

export function createSandboxEmailSender(): EmailSender {
  return {
    async send(params) {
      return {
        success: true,
        messageId: `sandbox-email:${params.tenantId}:${params.to}`,
        mode: 'sandbox',
        honestyNote: EMAIL_SANDBOX_HONESTY_NOTE,
      };
    },
  };
}
