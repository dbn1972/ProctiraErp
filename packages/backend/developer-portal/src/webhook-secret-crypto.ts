/**
 * PRC-M211: webhook signing secrets at rest.
 *
 * A webhook secret is an HMAC key the delivery worker must use, so a one-way hash cannot work.
 * Secrets are sealed with AES-256-GCM under `WEBHOOK_SECRET_ENCRYPTION_KEY` (32 bytes, base64
 * or hex; supply it from KMS/Secrets Manager), bound to the webhook id + tenant via AAD so a
 * ciphertext copied onto another row does not decrypt. The worker decrypts from the row; the
 * secret never travels in a queue message.
 *
 * Production fails closed without a key. Elsewhere one ephemeral per-process key is generated
 * (secrets then do not survive a restart, and deliveries fail closed until rotated).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { AppError } from '@proctira/common';

const PREFIX = 'wsk:v1:';

/** 503 so routes surface "not configured" instead of a generic 500. */
export class WebhookSecretKeyMissingError extends AppError {
  constructor() {
    super(
      'WEBHOOK_SECRET_ENCRYPTION_KEY is required to store webhook signing secrets',
      'WEBHOOK_SECRET_KEY_MISSING',
      503,
    );
  }
}

let ephemeralKey: Buffer | null = null;

function parseKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
  const b64 = Buffer.from(trimmed, 'base64');
  return b64.length === 32 ? b64 : null;
}

/** Resolve the sealing key; throws in production when it is missing or malformed. */
export function resolveWebhookSecretKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env['WEBHOOK_SECRET_ENCRYPTION_KEY'];
  if (raw && raw.trim()) {
    const key = parseKey(raw);
    if (key) return key;
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)');
  }
  if (env['NODE_ENV'] === 'production') throw new WebhookSecretKeyMissingError();
  ephemeralKey ??= randomBytes(32);
  return ephemeralKey;
}

function aad(webhookId: string, tenantId: string): Buffer {
  return Buffer.from(`webhook-secret:${tenantId}:${webhookId}`, 'utf8');
}

export function sealWebhookSecret(
  secret: string,
  scope: { webhookId: string; tenantId: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = resolveWebhookSecretKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(scope.webhookId, scope.tenantId));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

/** Returns the secret, or null when the value is absent, malformed, or fails authentication. */
export function openWebhookSecret(
  sealed: string | null | undefined,
  scope: { webhookId: string; tenantId: string },
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!sealed || !sealed.startsWith(PREFIX)) return null;
  const [ivB64, tagB64, dataB64] = sealed.slice(PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || dataB64 === undefined) return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      resolveWebhookSecretKey(env),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAAD(aad(scope.webhookId, scope.tenantId));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** Test helper: forget the ephemeral key (simulates a restart). */
export function resetEphemeralWebhookSecretKeyForTests(): void {
  ephemeralKey = null;
}
