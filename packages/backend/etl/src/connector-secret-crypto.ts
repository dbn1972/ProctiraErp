/**
 * PRC-M224 — encryption at rest for ETL connector credentials.
 *
 * Pipelines are stored as JSONB documents; before this, `password`,
 * `connectionString` and every `authConfig` value were stored in plaintext.
 * They are now sealed with AES-256-GCM using a per-tenant key derived from
 * `ETL_CONNECTOR_SECRET_KEY` (base64, 32 bytes) and the tenant id as AAD, so a
 * ciphertext copied to another tenant's row does not decrypt.
 *
 * Fail closed: in production, storing a pipeline that carries a secret without
 * the key configured is refused (503). Outside production, plaintext is still
 * allowed so local dev works without key material. Existing plaintext rows keep
 * reading (legacy) and are sealed on their next update.
 *
 * Format: `etlsec:v1:<iv b64>:<tag b64>:<data b64>`.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { AppError } from '@proctira/common';

const PREFIX = 'etlsec:v1:';
const SECRET_KEYS = new Set(['password', 'connectionString']);
const SECRET_MAP_KEYS = new Set(['authConfig']);

export class ConnectorSecretKeyMissingError extends AppError {
  constructor() {
    super(
      'Connector credentials cannot be stored: ETL_CONNECTOR_SECRET_KEY is not configured',
      'ETL_SECRET_KEY_MISSING',
      503,
    );
  }
}

export interface ConnectorSecretCipher {
  /** True when values are actually encrypted (a key is configured). */
  readonly enabled: boolean;
  seal(tenantId: string, plaintext: string): string;
  open(tenantId: string, value: string): string;
}

export function isSealedSecret(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** AES-256-GCM cipher with a per-tenant HMAC-derived key. */
export class AesGcmConnectorSecretCipher implements ConnectorSecretCipher {
  readonly enabled = true;

  constructor(private readonly rootKey: Buffer) {
    if (rootKey.length !== 32) {
      throw new Error('ETL_CONNECTOR_SECRET_KEY must decode to exactly 32 bytes');
    }
  }

  private keyFor(tenantId: string): Buffer {
    return createHmac('sha256', this.rootKey).update(`etl-connector:v1:${tenantId}`).digest();
  }

  seal(tenantId: string, plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keyFor(tenantId), iv);
    cipher.setAAD(Buffer.from(tenantId, 'utf8'));
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  open(tenantId: string, value: string): string {
    if (!isSealedSecret(value)) return value; // legacy plaintext row
    const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
    if (!ivB64 || !tagB64 || dataB64 === undefined) {
      throw new Error('Malformed connector secret ciphertext');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.keyFor(tenantId),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAAD(Buffer.from(tenantId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** No key configured: plaintext passthrough (non-production only, see factory). */
class PlaintextConnectorSecretCipher implements ConnectorSecretCipher {
  readonly enabled = false;
  constructor(private readonly failClosed: boolean) {}
  seal(_tenantId: string, plaintext: string): string {
    if (this.failClosed) throw new ConnectorSecretKeyMissingError();
    return plaintext;
  }
  open(_tenantId: string, value: string): string {
    if (isSealedSecret(value)) {
      throw new AppError(
        'Stored connector credentials are encrypted but ETL_CONNECTOR_SECRET_KEY is not configured',
        'ETL_SECRET_KEY_MISSING',
        503,
      );
    }
    return value;
  }
}

/** Cipher from env: key → AES-GCM; no key → plaintext outside prod, fail closed in prod. */
export function createConnectorSecretCipher(
  env: NodeJS.ProcessEnv = process.env,
): ConnectorSecretCipher {
  const raw = env['ETL_CONNECTOR_SECRET_KEY']?.trim();
  if (raw) return new AesGcmConnectorSecretCipher(Buffer.from(raw, 'base64'));
  return new PlaintextConnectorSecretCipher(env['NODE_ENV'] === 'production');
}

type Config = Record<string, unknown>;
const isRecord = (v: unknown): v is Config =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function mapSecrets<T>(config: T, fn: (value: string) => string): T {
  if (!isRecord(config)) return config;
  const out: Config = { ...config };
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEYS.has(key) && typeof value === 'string' && value.length > 0) {
      out[key] = fn(value);
    } else if (SECRET_MAP_KEYS.has(key) && isRecord(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          typeof v === 'string' && v.length > 0 ? fn(v) : v,
        ]),
      );
    }
  }
  return out as T;
}

/** Seal secret fields of a source/destination config for storage. */
export function sealConnectorSecrets<T>(
  config: T,
  tenantId: string,
  cipher: ConnectorSecretCipher,
): T {
  return mapSecrets(config, (v) => (isSealedSecret(v) ? v : cipher.seal(tenantId, v)));
}

/** Open sealed secret fields of a stored source/destination config. */
export function openConnectorSecrets<T>(
  config: T,
  tenantId: string,
  cipher: ConnectorSecretCipher,
): T {
  return mapSecrets(config, (v) => cipher.open(tenantId, v));
}
