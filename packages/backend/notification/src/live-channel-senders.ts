/**
 * PRC-M326: live channel senders chosen by the owner (DR50): SMS via MSG91, email via
 * Amazon SES (v2 API) and push via Firebase Cloud Messaging (HTTP v1). Built against
 * stubbed providers first; no SDK dependency (fetch + node:crypto), so the lockfile is
 * unchanged. Credentials come only from env populated by the secret manager.
 *
 * Env var names:
 *   SMS   MSG91_AUTH_KEY, MSG91_TEMPLATE_ID, optional MSG91_API_BASE_URL
 *   Email SES_REGION, SES_FROM_ADDRESS, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 *         optional AWS_SESSION_TOKEN, SES_API_BASE_URL
 *   Push  FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY, optional FCM_API_BASE_URL,
 *         FCM_TOKEN_URL
 *
 * Every sender returns `success: false` with a short error on any provider refusal or
 * transport failure; provider response bodies are never echoed (they can hold PII).
 */
import { createHash, createHmac, createSign } from 'node:crypto';

import type { EmailSender, PushSender, SmsSender } from './notification-service.js';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
type Env = Record<string, string | undefined>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

function trimmed(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ─── SMS: MSG91 ───────────────────────────────────────────────────────────────

export interface Msg91Config {
  authKey: string;
  templateId: string;
  apiBaseUrl?: string;
}

export function loadMsg91ConfigFromEnv(env: Env = process.env): Msg91Config | null {
  const authKey = trimmed(env, 'MSG91_AUTH_KEY');
  const templateId = trimmed(env, 'MSG91_TEMPLATE_ID');
  if (!authKey || !templateId) return null;
  const apiBaseUrl = trimmed(env, 'MSG91_API_BASE_URL');
  return { authKey, templateId, ...(apiBaseUrl ? { apiBaseUrl } : {}) };
}

/** MSG91 Flow API: one DLT template, the notification text in the `body` variable. */
export function createMsg91SmsSender(config: Msg91Config, fetchImpl = defaultFetch): SmsSender {
  const base = (config.apiBaseUrl ?? 'https://control.msg91.com/api/v5').replace(/\/+$/, '');
  return {
    async send({ to, body }) {
      const mobiles = to.replace(/[^\d]/g, '');
      if (mobiles.length < 10 || mobiles.length > 15) {
        return { success: false, error: 'Invalid SMS recipient number', mode: 'live' };
      }
      try {
        const response = await fetchImpl(`${base}/flow/`, {
          method: 'POST',
          headers: { authkey: config.authKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: config.templateId,
            short_url: '0',
            recipients: [{ mobiles, body }],
          }),
        });
        const json = await readJson(response);
        if (!response.ok || json?.type !== 'success') {
          return {
            success: false,
            error: `MSG91 refused the SMS (${response.status})`,
            mode: 'live',
          };
        }
        return {
          success: true,
          messageId: typeof json.message === 'string' ? json.message : undefined,
          mode: 'live',
        };
      } catch {
        return { success: false, error: 'MSG91 request failed', mode: 'live' };
      }
    },
  };
}

// ─── Email: Amazon SES v2 (SigV4) ────────────────────────────────────────────

export interface SesConfig {
  region: string;
  fromAddress: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  apiBaseUrl?: string;
}

export function loadSesConfigFromEnv(env: Env = process.env): SesConfig | null {
  const region = trimmed(env, 'SES_REGION');
  const fromAddress = trimmed(env, 'SES_FROM_ADDRESS');
  const accessKeyId = trimmed(env, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = trimmed(env, 'AWS_SECRET_ACCESS_KEY');
  if (!region || !fromAddress || !accessKeyId || !secretAccessKey) return null;
  const sessionToken = trimmed(env, 'AWS_SESSION_TOKEN');
  const apiBaseUrl = trimmed(env, 'SES_API_BASE_URL');
  return {
    region,
    fromAddress,
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
  };
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * AWS Signature Version 4 for a request without a query string. Returns the headers
 * to send (including Authorization). Header names are lower-cased and all signed.
 */
export function signAwsV4(input: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  now?: Date;
}): Record<string, string> {
  const url = new URL(input.url);
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = value.trim();
  }
  headers.host = url.host;
  headers['x-amz-date'] = amzDate;
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name] ?? ''}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method.toUpperCase(),
    url.pathname || '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body),
  ].join('\n');
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** SES v2 SendEmail (plain-text body). */
export function createSesEmailSender(
  config: SesConfig,
  fetchImpl = defaultFetch,
  now: () => Date = () => new Date(),
): EmailSender {
  const base = (config.apiBaseUrl ?? `https://email.${config.region}.amazonaws.com`).replace(
    /\/+$/,
    '',
  );
  return {
    async send({ to, subject, body }) {
      const url = `${base}/v2/email/outbound-emails`;
      const payload = JSON.stringify({
        FromEmailAddress: config.fromAddress,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: body, Charset: 'UTF-8' } },
          },
        },
      });
      const headers = signAwsV4({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        body: payload,
        region: config.region,
        service: 'ses',
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
        now: now(),
      });
      // `host` is set by fetch from the URL; sending it explicitly is not allowed.
      const { host: _host, ...sendHeaders } = headers;
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: sendHeaders,
          body: payload,
        });
        const json = await readJson(response);
        if (!response.ok || typeof json?.MessageId !== 'string') {
          return {
            success: false,
            error: `SES refused the email (${response.status})`,
            mode: 'live',
          };
        }
        return { success: true, messageId: json.MessageId, mode: 'live' };
      } catch {
        return { success: false, error: 'SES request failed', mode: 'live' };
      }
    },
  };
}

// ─── Push: Firebase Cloud Messaging HTTP v1 ─────────────────────────────────

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  /** PEM private key of the service account (`\n` escapes allowed). */
  privateKey: string;
  apiBaseUrl?: string;
  tokenUrl?: string;
}

export function loadFcmConfigFromEnv(env: Env = process.env): FcmConfig | null {
  const projectId = trimmed(env, 'FCM_PROJECT_ID');
  const clientEmail = trimmed(env, 'FCM_CLIENT_EMAIL');
  const privateKey = trimmed(env, 'FCM_PRIVATE_KEY');
  if (!projectId || !clientEmail || !privateKey) return null;
  const apiBaseUrl = trimmed(env, 'FCM_API_BASE_URL');
  const tokenUrl = trimmed(env, 'FCM_TOKEN_URL');
  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...(tokenUrl ? { tokenUrl } : {}),
  };
}

/** Device tokens registered for a user (notification_devices). */
export type DeviceTokenLookup = (tenantId: string, userId: string) => Promise<string[]>;

function base64Url(data: string | Buffer): string {
  return Buffer.from(data).toString('base64url');
}

export function createFcmPushSender(
  config: FcmConfig,
  listDeviceTokens: DeviceTokenLookup,
  fetchImpl = defaultFetch,
  now: () => Date = () => new Date(),
): PushSender {
  const base = (config.apiBaseUrl ?? 'https://fcm.googleapis.com').replace(/\/+$/, '');
  const tokenUrl = config.tokenUrl ?? 'https://oauth2.googleapis.com/token';
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    const nowMs = now().getTime();
    if (cached && cached.expiresAt - 60_000 > nowMs) return cached.token;
    const iat = Math.floor(nowMs / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: config.clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: tokenUrl,
        iat,
        exp: iat + 3600,
      }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${base64Url(signer.sign(config.privateKey))}`;
    const response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    const json = await readJson(response);
    if (!response.ok || typeof json?.access_token !== 'string') {
      throw new Error(`FCM token request refused (${response.status})`);
    }
    const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    cached = { token: json.access_token, expiresAt: nowMs + expiresIn * 1000 };
    return cached.token;
  }

  return {
    async send({ userId, title, body, data, tenantId }) {
      try {
        const tokens = await listDeviceTokens(tenantId, userId);
        if (tokens.length === 0) {
          return { success: false, error: 'No registered push device for this user', mode: 'live' };
        }
        const bearer = await accessToken();
        const accepted: string[] = [];
        for (const token of tokens) {
          const response = await fetchImpl(
            `${base}/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: { token, notification: { title, body }, ...(data ? { data } : {}) },
              }),
            },
          );
          const json = await readJson(response);
          if (response.ok && typeof json?.name === 'string') accepted.push(json.name);
        }
        if (accepted.length === 0) {
          return { success: false, error: 'FCM refused the push for every device', mode: 'live' };
        }
        return { success: true, messageId: accepted[0], mode: 'live' };
      } catch {
        return { success: false, error: 'FCM request failed', mode: 'live' };
      }
    },
  };
}
