/**
 * @proctira/backend-providers — G-7 headless provider facade.
 * Sandbox adapters + capability discovery.
 *
 * W2-INT-03: credentials / PROVIDER_MODE=live alone must NOT report liveReady.
 * Live SMS/email/push/PSP adapters are not implemented in-tree; claiming live
 * would enable silent stub success. IdP may report issuer URL presence only.
 */

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
 */
export function listProviderCapabilities(
  env: Record<string, string | undefined> = {},
): ProviderCapability[] {
  const wantsLive = env.PROVIDER_MODE === 'live';
  const idpConfigured = Boolean(env.KEYCLOAK_URL || env.OIDC_ISSUER);

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
    {
      channel: 'psp',
      mode: 'sandbox',
      adapter: 'SandboxPaymentAdapter',
      liveReady: false,
      notes: wantsLive
        ? 'PROVIDER_MODE=live requested but live PSP adapter not implemented — sandbox stub only (G-202); refuse silent live success.'
        : 'Fees uses SandboxPaymentAdapter by default (G-202).',
    },
    {
      channel: 'sms',
      mode: 'sandbox',
      adapter: 'SandboxSmsSender',
      liveReady: false,
      notes: wantsLive || env.TWILIO_AUTH_TOKEN
        ? 'Twilio credentials/PROVIDER_MODE=live detected but live SMS adapter not implemented — sandbox stub only; refuse silent live success.'
        : 'Notification package sandbox SMS (G-709).',
    },
    {
      channel: 'email',
      mode: 'sandbox',
      adapter: 'SandboxEmailSender',
      liveReady: false,
      notes: wantsLive || env.SMTP_URL || env.SES_REGION
        ? 'SMTP/SES/PROVIDER_MODE=live detected but live email adapter not implemented — sandbox stub only; refuse silent live success.'
        : 'Sandbox email unless a live adapter is wired.',
    },
    {
      channel: 'push',
      mode: 'sandbox',
      adapter: 'SandboxPushSender',
      liveReady: false,
      notes: wantsLive || env.FCM_SERVER_KEY
        ? 'FCM/PROVIDER_MODE=live detected but live push adapter not implemented — sandbox stub only; refuse silent live success.'
        : 'Push remains sandbox without a live FCM adapter.',
    },
  ];
}
