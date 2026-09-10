/**
 * G-922 — WhatsApp channel adapter.
 *
 * Sandbox implementation logs intent and never opens a network connection.
 * A future live adapter (Meta Cloud API or Twilio) should read:
 *   WHATSAPP_PROVIDER              meta | twilio
 *   WHATSAPP_ACCESS_TOKEN          API bearer token
 *   WHATSAPP_PHONE_NUMBER_ID       Meta sender id
 *   WHATSAPP_BUSINESS_ACCOUNT_ID   WABA id
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN  inbound webhook verify
 *   WHATSAPP_API_BASE_URL          override (default graph.facebook.com)
 * Live provider is waived this slice — do not call those endpoints from here.
 */

export const WHATSAPP_SANDBOX_HONESTY_NOTE =
  'Sandbox WhatsApp adapter — delivery logged locally; no Meta/Twilio network call. Set WHATSAPP_PROVIDER + WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID for a future live adapter.';

export const WHATSAPP_LIVE_ENV_VARS = [
  'WHATSAPP_PROVIDER',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'WHATSAPP_API_BASE_URL',
] as const;

export interface WhatsAppSendRequest {
  tenantId: string;
  recipientId: string;
  recipientLabel?: string;
  title?: string;
  body: string;
  sourceType: 'campaign' | 'emergency' | 'circular';
  sourceId: string;
}

export interface WhatsAppSendResult {
  mode: 'sandbox';
  providerRef: string;
  status: 'sent';
  honestyNote: string;
}

export interface WhatsAppChannelAdapter {
  send(request: WhatsAppSendRequest): Promise<WhatsAppSendResult>;
}

export function createSandboxWhatsAppAdapter(): WhatsAppChannelAdapter {
  return {
    async send(request) {
      return {
        mode: 'sandbox',
        providerRef: `sandbox-wa:${request.tenantId}:${request.sourceId}:${request.recipientId}:${Date.now()}`,
        status: 'sent',
        honestyNote: WHATSAPP_SANDBOX_HONESTY_NOTE,
      };
    },
  };
}
