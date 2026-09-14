/**
 * G-604 — Communication channel delivery adapter (sandbox stub).
 * W2-INT-03: PROVIDER_MODE=live must not silently mark sent via stub.
 *
 * Mirrors notification sandbox senders until Twilio/SES/FCM credentials + live adapters exist.
 */
export type DeliveryChannel = 'email' | 'sms' | 'push' | 'in_app' | 'whatsapp';

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
  'Sandbox communication delivery — status marked sent without calling SMS/email/push/WhatsApp providers. Wire Twilio/SES/FCM or WHATSAPP_* credentials for production delivery.';

export const COMMS_LIVE_UNIMPLEMENTED_NOTE =
  'Live communication delivery adapter not implemented — refusing silent success. Unset PROVIDER_MODE=live or wire Twilio/SES/FCM.';

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

/** Fail-closed when operators request live mode without a wired provider client. */
export function createUnimplementedLiveDeliveryAdapter(): CommunicationDeliveryAdapter {
  return {
    async deliver() {
      throw new Error(COMMS_LIVE_UNIMPLEMENTED_NOTE);
    },
  };
}

export function createDeliveryAdapterFromEnv(
  env: Record<string, string | undefined> = process.env,
): CommunicationDeliveryAdapter {
  if (env.PROVIDER_MODE === 'live') {
    return createUnimplementedLiveDeliveryAdapter();
  }
  return createSandboxDeliveryAdapter();
}
