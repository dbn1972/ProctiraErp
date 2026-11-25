/**
 * @proctira/backend-providers — G-7 headless provider facade.
 * Sandbox adapters + capability discovery.
 *
 * W2-INT-03: credentials / PROVIDER_MODE=live alone must NOT report liveReady.
 * PRC-M326 (DR36/DR50): live adapters now exist for the chosen providers — PSP
 * Razorpay (@proctira/backend-fees), SMS MSG91, email Amazon SES, push FCM
 * (@proctira/backend-notification). A channel reports live only when
 * PROVIDER_MODE=live AND that adapter's full credential set is configured; any
 * other credential (Twilio, SMTP, legacy FCM server key) still reports sandbox.
 * IdP may report issuer URL presence only.
 *
 * W1-ARCH-08: production refuses silent sandbox defaults — callers must pass an
 * env that either sets PROVIDER_MODE=live or explicitly opts into sandbox.
 */

import { resolveProviderDeliveryMode } from '@proctira/common';

export type ProviderMode = 'sandbox' | 'live';

export interface ProviderCapability {
  channel: 'idp' | 'psp' | 'sms' | 'email' | 'push';
  mode: ProviderMode;
  adapter: string;
  liveReady: boolean;
  notes: string;
}

export interface SandboxIdpToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  subject: string;
  tenantId: string;
  roles: string[];
}

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** ASCII-only base64url (no padding). JSON payloads in this facade are ASCII. */
function encodeBase64Url(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    bytes.push(value.charCodeAt(i) & 0xff);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triplet = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64URL_ALPHABET[(triplet >> 18) & 63] ?? '';
    out += BASE64URL_ALPHABET[(triplet >> 12) & 63] ?? '';
    if (b !== undefined) out += BASE64URL_ALPHABET[(triplet >> 6) & 63] ?? '';
    if (c !== undefined) out += BASE64URL_ALPHABET[triplet & 63] ?? '';
  }
  return out;
}

/** Issues a local HS256-shaped opaque token (not a real JWT crypto stack). */
export function issueSandboxIdpToken(input: {
  subject: string;
  tenantId: string;
  roles?: string[];
  secret?: string;
}): SandboxIdpToken {
  const header = encodeBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: input.subject,
      tid: input.tenantId,
      roles: input.roles ?? ['staff'],
      iss: 'proctira-sandbox-idp',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  const sig = encodeBase64Url(input.secret ?? 'sandbox').slice(0, 16);
  return {
    accessToken: `${header}.${payload}.${sig}`,
    tokenType: 'Bearer',
    expiresIn: 3600,
    subject: input.subject,
    tenantId: input.tenantId,
    roles: input.roles ?? ['staff'],
  };
}

/**
 * Capability discovery for install / ops consoles.
 *
 * W2-INT-03 honesty: SMS/email/push/PSP live adapters are **not** wired.
 * Env credentials must not flip `liveReady` or `mode: 'live'` — that previously
 * implied production delivery while sandbox stubs still silently succeeded.
 *
 * W1-ARCH-08: throws in production when sandbox would be the silent default.
 */
/** PRC-M326: env var names each live adapter needs (values live in the secret manager). */
export const LIVE_ADAPTER_ENV: Record<'psp' | 'sms' | 'email' | 'push', readonly string[]> = {
  psp: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
  sms: ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID'],
  email: ['SES_REGION', 'SES_FROM_ADDRESS', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  push: ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'],
};

const LIVE_ADAPTER_NAME: Record<keyof typeof LIVE_ADAPTER_ENV, string> = {
  psp: 'RazorpayPaymentAdapter',
  sms: 'Msg91SmsSender',
  email: 'SesEmailSender',
  push: 'FcmPushSender',
};

function liveConfigured(
  channel: keyof typeof LIVE_ADAPTER_ENV,
  env: Record<string, string | undefined>,
): boolean {
  return LIVE_ADAPTER_ENV[channel].every((name) => Boolean(env[name]?.trim()));
}

function liveCapability(channel: keyof typeof LIVE_ADAPTER_ENV): ProviderCapability {
  return {
    channel,
    mode: 'live',
    adapter: LIVE_ADAPTER_NAME[channel],
    liveReady: true,
    notes:
      `${LIVE_ADAPTER_NAME[channel]} configured (${LIVE_ADAPTER_ENV[channel].join(', ')} set). ` +
      'Built and contract-tested against a stubbed provider; delivery against the real ' +
      'provider is verified only by a run with these credentials.' +
      (channel === 'push' ? ' Push also needs the notification device store.' : ''),
  };
}

export function listProviderCapabilities(
  env: Record<string, string | undefined> = {},
): ProviderCapability[] {
  const deliveryMode = resolveProviderDeliveryMode('providers', env);
  const wantsLive = deliveryMode === 'live';
  const idpConfigured = Boolean(env.KEYCLOAK_URL || env.OIDC_ISSUER);
  const live = (channel: keyof typeof LIVE_ADAPTER_ENV) =>
    wantsLive && liveConfigured(channel, env) ? liveCapability(channel) : null;

  return [
    {
      channel: 'idp',
      mode: idpConfigured ? (wantsLive ? 'live' : 'sandbox') : 'sandbox',
      adapter: idpConfigured ? 'oidc/keycloak' : 'FakeLocalIdpAdapter',
      // IdP mint/verify is external; URL presence is readiness signal only.
      liveReady: idpConfigured,
      notes: idpConfigured
        ? 'OIDC issuer configured (G-107 realm secrets still required for production).'
        : 'Live IdP waived without realm secrets (G-107).',
    },
    live('psp') ?? {
      channel: 'psp',
      mode: 'sandbox',
      adapter: 'SandboxPaymentAdapter',
      liveReady: false,
      notes: wantsLive
        ? 'PROVIDER_MODE=live requested but Razorpay credentials are not configured — sandbox stub only (G-202); refuse silent live success.'
        : 'Fees uses SandboxPaymentAdapter when sandbox is allowed (G-202); production requires explicit opt-in (W1-ARCH-08).',
    },
    live('sms') ?? {
      channel: 'sms',
      mode: 'sandbox',
      adapter: 'SandboxSmsSender',
      liveReady: false,
      notes:
        wantsLive || env.TWILIO_AUTH_TOKEN
          ? 'PROVIDER_MODE=live or Twilio credentials detected but MSG91 is not configured (the only live SMS adapter) — sandbox stub only; refuse silent live success.'
          : 'Notification package sandbox SMS (G-709); production requires explicit opt-in (W1-ARCH-08).',
    },
    live('email') ?? {
      channel: 'email',
      mode: 'sandbox',
      adapter: 'SandboxEmailSender',
      liveReady: false,
      notes:
        wantsLive || env.SMTP_URL || env.SES_REGION
          ? 'SMTP/SES/PROVIDER_MODE=live detected but the SES credential set is incomplete — sandbox stub only; refuse silent live success.'
          : 'Sandbox email unless a live adapter is wired; production requires explicit opt-in (W1-ARCH-08).',
    },
    live('push') ?? {
      channel: 'push',
      mode: 'sandbox',
      adapter: 'SandboxPushSender',
      liveReady: false,
      notes:
        wantsLive || env.FCM_SERVER_KEY
          ? 'FCM/PROVIDER_MODE=live detected but the FCM service-account set is incomplete — sandbox stub only; refuse silent live success.'
          : 'Push remains sandbox without a live FCM adapter; production requires explicit opt-in (W1-ARCH-08).',
    },
  ];
}
