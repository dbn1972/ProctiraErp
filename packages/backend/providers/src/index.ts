/**
 * G-7 headless provider facade — sandbox adapters + capability discovery.
 * Live IdP/PSP/SMS require secrets; sandbox mode is the honest default.
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

/** Issues a local HS256-shaped opaque token (not a real JWT crypto stack). */
export function issueSandboxIdpToken(input: {
  subject: string;
  tenantId: string;
  roles?: string[];
  secret?: string;
}): SandboxIdpToken {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: input.subject,
      tid: input.tenantId,
      roles: input.roles ?? ['staff'],
      iss: 'proctira-sandbox-idp',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  const sig = Buffer.from(input.secret ?? 'sandbox').toString('base64url').slice(0, 16);
  return {
    accessToken: `${header}.${payload}.${sig}`,
    tokenType: 'Bearer',
    expiresIn: 3600,
    subject: input.subject,
    tenantId: input.tenantId,
    roles: input.roles ?? ['staff'],
  };
}

export function listProviderCapabilities(env: NodeJS.ProcessEnv = process.env): ProviderCapability[] {
  const mode = (env.PROVIDER_MODE === 'live' ? 'live' : 'sandbox') as ProviderMode;
  return [
    {
      channel: 'idp',
      mode: env.KEYCLOAK_URL || env.OIDC_ISSUER ? mode : 'sandbox',
      adapter: env.KEYCLOAK_URL || env.OIDC_ISSUER ? 'oidc/keycloak' : 'FakeLocalIdpAdapter',
      liveReady: Boolean(env.KEYCLOAK_URL || env.OIDC_ISSUER),
      notes: 'Live IdP waived without realm secrets (G-107).',
    },
    {
      channel: 'psp',
      mode: env.PSP_API_KEY ? mode : 'sandbox',
      adapter: env.PSP_API_KEY ? 'live-psp' : 'SandboxPaymentAdapter',
      liveReady: Boolean(env.PSP_API_KEY),
      notes: 'Fees uses SandboxPaymentAdapter by default (G-202).',
    },
    {
      channel: 'sms',
      mode: env.TWILIO_AUTH_TOKEN ? mode : 'sandbox',
      adapter: env.TWILIO_AUTH_TOKEN ? 'twilio' : 'SandboxSmsSender',
      liveReady: Boolean(env.TWILIO_AUTH_TOKEN),
      notes: 'Notification package sandbox SMS (G-709).',
    },
    {
      channel: 'email',
      mode: env.SMTP_URL || env.SES_REGION ? mode : 'sandbox',
      adapter: env.SMTP_URL || env.SES_REGION ? 'smtp/ses' : 'SandboxEmailSender',
      liveReady: Boolean(env.SMTP_URL || env.SES_REGION),
      notes: 'Sandbox email unless SMTP/SES configured.',
    },
    {
      channel: 'push',
      mode: env.FCM_SERVER_KEY ? mode : 'sandbox',
      adapter: env.FCM_SERVER_KEY ? 'fcm' : 'SandboxPushSender',
      liveReady: Boolean(env.FCM_SERVER_KEY),
      notes: 'Push remains sandbox without FCM key.',
    },
  ];
}
