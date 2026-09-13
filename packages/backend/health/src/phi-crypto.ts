/**
 * Field-level PHI encryption (G-203, W1-SEC-04).
 *
 * Master key from PHI_ENCRYPTION_KEY (32-byte base64 or hex, or utf8 hashed via
 * SHA-256). Per-institution DEKs are derived with HMAC-SHA256:
 *   `HMAC(master, "phi:v2:{tenantId}:{institutionId}")`
 *
 * Ciphertext formats:
 * - enc:v1:<iv>:<tag>:<data> — legacy global key (read-only compat)
 * - enc:v2:<tenantId>:<institutionId>:<iv>:<tag>:<data> — institution-scoped
 *
 * G-711: when the key is unset, values pass through plaintext ONLY outside
 * production. In production (`NODE_ENV=production`) a missing key throws at
 * the first PHI write/read and at {@link assertPhiKeyConfigured} (boot) unless
 * `ALLOW_PLAINTEXT_PHI=1` is set explicitly.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const PREFIX_V1 = 'enc:v1:';
const PREFIX_V2 = 'enc:v2:';

export interface PhiCryptoScope {
  tenantId: string;
  institutionId: string;
}

export class PhiKeyMissingError extends Error {
  constructor() {
    super(
      'PHI_ENCRYPTION_KEY is required in production (set a 32-byte base64/hex key, ' +
        'or ALLOW_PLAINTEXT_PHI=1 to explicitly accept plaintext PHI at rest)',
    );
    this.name = 'PhiKeyMissingError';
  }
}

function plaintextAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  const flag = env.ALLOW_PLAINTEXT_PHI?.trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

/**
 * Boot-time guard: throws in production when no key is configured and
 * plaintext PHI has not been explicitly allowed.
 */
export function assertPhiKeyConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.PHI_ENCRYPTION_KEY?.trim() && !plaintextAllowed(env)) {
    throw new PhiKeyMissingError();
  }
}

function resolveMasterKey(): Buffer | null {
  const raw = process.env.PHI_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (!plaintextAllowed()) throw new PhiKeyMissingError();
    return null;
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    // fall through to hash
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

function deriveScopedKey(scope: PhiCryptoScope, master: Buffer): Buffer {
  return createHmac('sha256', master)
    .update(`phi:v2:${scope.tenantId}:${scope.institutionId}`, 'utf8')
    .digest();
}

function resolveKey(scope?: PhiCryptoScope): Buffer | null {
  const master = resolveMasterKey();
  if (!master) return null;
  if (scope?.tenantId && scope.institutionId) {
    return deriveScopedKey(scope, master);
  }
  return master;
}

/** Build scope from tenant + student enrollment institution (falls back to studentId). */
export function phiScopeForStudent(
  tenantId: string,
  studentId: string,
  institutionId?: string | null,
): PhiCryptoScope {
  return {
    tenantId,
    institutionId: institutionId?.trim() || studentId,
  };
}

export function isPhiEncryptionEnabled(): boolean {
  return Boolean(process.env.PHI_ENCRYPTION_KEY?.trim());
}

/** True when `value` is an enc:v1/v2 ciphertext (used by tests / migrations). */
export function isPhiCiphertext(value: string | null | undefined): boolean {
  return (
    typeof value === 'string' && (value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V2))
  );
}

function parseV2Scope(body: string): { scope: PhiCryptoScope; ivB64: string; tagB64: string; dataB64: string } | null {
  const parts = body.split(':');
  if (parts.length !== 5) return null;
  const [tenantId, institutionId, ivB64, tagB64, dataB64] = parts;
  if (!tenantId || !institutionId || !ivB64 || !tagB64 || !dataB64) return null;
  return { scope: { tenantId, institutionId }, ivB64, tagB64, dataB64 };
}

function encryptWithKey(
  plaintext: string,
  key: Buffer,
  prefix: string,
  scopeLabel?: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  return scopeLabel ? `${prefix}${scopeLabel}:${payload}` : `${prefix}${payload}`;
}

export function encryptPhi(
  plaintext: string | null | undefined,
  scope?: PhiCryptoScope,
): string | null {
  if (plaintext == null) return null;
  if (plaintext.startsWith(PREFIX_V1) || plaintext.startsWith(PREFIX_V2)) return plaintext;

  const master = resolveMasterKey();
  if (!master) return plaintext;

  if (scope?.tenantId && scope.institutionId) {
    const key = deriveScopedKey(scope, master);
    return encryptWithKey(
      plaintext,
      key,
      PREFIX_V2,
      `${scope.tenantId}:${scope.institutionId}`,
    );
  }

  const key = master;
  return encryptWithKey(plaintext, key, PREFIX_V1);
}

export function decryptPhi(
  value: string | null | undefined,
  scope?: PhiCryptoScope,
): string | null {
  if (value == null) return null;
  if (!value.startsWith(PREFIX_V1) && !value.startsWith(PREFIX_V2)) return value;

  const master = resolveMasterKey();
  if (!master) {
    throw new Error('PHI_ENCRYPTION_KEY is required to decrypt enc:v1/v2 payloads');
  }

  if (value.startsWith(PREFIX_V2)) {
    const parsed = parseV2Scope(value.slice(PREFIX_V2.length));
    if (!parsed) throw new Error('Invalid enc:v2 PHI ciphertext');
    if (
      scope &&
      (scope.tenantId !== parsed.scope.tenantId || scope.institutionId !== parsed.scope.institutionId)
    ) {
      throw new Error('Invalid enc:v2 PHI ciphertext: institution scope mismatch');
    }
    const key = deriveScopedKey(parsed.scope, master);
    const iv = Buffer.from(parsed.ivB64, 'base64');
    const tag = Buffer.from(parsed.tagB64, 'base64');
    const data = Buffer.from(parsed.dataB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Invalid enc:v2 PHI ciphertext');
    }
  }

  const body = value.slice(PREFIX_V1.length);
  const [ivB64, tagB64, dataB64] = body.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid enc:v1 PHI ciphertext');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', master, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
