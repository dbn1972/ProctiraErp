/**
 * G-922 — WhatsApp channel adapter.
 * W1-ARCH-08: production/live refuses silent sandbox default; live without
 * WHATSAPP_* credentials fails closed at factory load.
 *
 * Sandbox implementation logs intent and never opens a network connection.
 * A future live adapter (Meta Cloud API or Twilio) should read:
 *   WHATSAPP_PROVIDER              meta | twilio
 *   WHATSAPP_ACCESS_TOKEN          API bearer token
 *   WHATSAPP_PHONE_NUMBER_ID       Meta sender id
 *   WHATSAPP_BUSINESS_ACCOUNT_ID   WABA id
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN  inbound webhook verify
 *   WHATSAPP_API_BASE_URL          override (default graph.facebook.com)
 * Live network client is not wired this slice — credentials only gate the
 * honest live stub so operators cannot silently fall back to sandbox.
 */
import { resolveProviderDeliveryMode } from '@proctira/common';

export const WHATSAPP_SANDBOX_HONESTY_NOTE =
  'Sandbox WhatsApp adapter — delivery logged locally; no Meta/Twilio network call. Set WHATSAPP_PROVIDER + WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID for a future live adapter.';

export const WHATSAPP_LIVE_UNIMPLEMENTED_NOTE =
  'Live WhatsApp adapter not implemented — refusing silent success. Credentials present but Meta/Twilio client is not wired. Unset PROVIDER_MODE=live or wire the live WhatsApp client.';

export const WHATSAPP_LIVE_MISSING_CREDS_NOTE =
  'Live WhatsApp mode requires WHATSAPP_PROVIDER, WHATSAPP_ACCESS_TOKEN, and WHATSAPP_PHONE_NUMBER_ID — refusing silent sandbox fallback (W1-ARCH-08).';

/** Credentials required before a live WhatsApp adapter may be constructed. */
export const WHATSAPP_REQUIRED_LIVE_ENV_VARS = [
  'WHATSAPP_PROVIDER',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const;

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
  mode: 'sandbox' | 'live';
  providerRef: string;
  status: 'sent' | 'failed';
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

/**
 * Honest live stub — credentials were present but no Meta/Twilio client is wired.
 * Refuses silent success (same posture as communication delivery live stub).
 */
export function createUnimplementedLiveWhatsAppAdapter(): WhatsAppChannelAdapter {
  return {
    async send() {
      throw new Error(WHATSAPP_LIVE_UNIMPLEMENTED_NOTE);
    },
  };
}

function hasRequiredWhatsAppLiveCredentials(
  env: Record<string, string | undefined>,
): boolean {
  return WHATSAPP_REQUIRED_LIVE_ENV_VARS.every((key) => {
    const value = env[key]?.trim();
    return value !== undefined && value.length > 0;
  });
}

/**
 * Env-driven WhatsApp adapter (W1-ARCH-08).
 *
 * - sandbox / non-live → sandbox adapter
 * - live without required WHATSAPP_* credentials → throw (fail closed)
 * - live with credentials → honest unimplemented live stub (no silent sandbox)
 */
export function createWhatsAppAdapter(
  env: Record<string, string | undefined> = process.env,
): WhatsAppChannelAdapter {
  if (resolveProviderDeliveryMode('whatsapp', env) === 'live') {
    if (!hasRequiredWhatsAppLiveCredentials(env)) {
      throw new Error(WHATSAPP_LIVE_MISSING_CREDS_NOTE);
    }
    return createUnimplementedLiveWhatsAppAdapter();
  }
  return createSandboxWhatsAppAdapter();
}
