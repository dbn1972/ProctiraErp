/**
 * G-604 — Communication channel delivery adapter (sandbox stub).
 *
 * Mirrors notification sandbox senders until Twilio/SES/FCM credentials exist.
 */
export type DeliveryChannel = 'email' | 'sms' | 'push' | 'in_app';

export interface DeliveryRequest {
  tenantId: string;
  channels: string[];
  subject?: string;
  body?: string;
  reason?: string;
  estimatedRecipients?: number;
}

export interface DeliveryResult {
  mode: 'sandbox' | 'live';
  messageId: string;
  channelsAttempted: string[];
  honestyNote: string;
}

export interface CommunicationDeliveryAdapter {
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
}

export const COMMS_SANDBOX_HONESTY_NOTE =
  'Sandbox communication delivery — status marked sent without calling SMS/email/push providers. Wire Twilio/SES/FCM credentials for production delivery.';

export function createSandboxDeliveryAdapter(): CommunicationDeliveryAdapter {
  return {
    async deliver(request) {
      const channels = (request.channels.length > 0 ? request.channels : ['in_app']).map((c) =>
        c.toLowerCase(),
      );
      return {
        mode: 'sandbox',
        messageId: `sandbox-comms:${request.tenantId}:${Date.now()}`,
        channelsAttempted: channels,
        honestyNote: COMMS_SANDBOX_HONESTY_NOTE,
      };
    },
  };
}
