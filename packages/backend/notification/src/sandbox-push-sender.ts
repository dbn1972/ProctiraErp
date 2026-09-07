/**
 * Sandbox push sender — accepts messages without calling FCM/APNs.
 * Wire FCM (or equivalent) behind PushSender for production delivery.
 */
import type { PushSender } from './notification-service.js';

export const PUSH_SANDBOX_HONESTY_NOTE =
  'Sandbox push — device registration and sends are accepted without calling FCM/APNs. Wire FCM credentials for production delivery.';

export function createSandboxPushSender(): PushSender {
  return {
    async send(params) {
      return {
        success: true,
        messageId: `sandbox-push:${params.tenantId}:${params.userId}`,
        mode: 'sandbox',
        honestyNote: PUSH_SANDBOX_HONESTY_NOTE,
      };
    },
  };
}
