/**
 * Field-level PHI encryption (G-203, W1-SEC-04 COMPLETE).
 *
 * Root key material comes from a {@link PhiEnvelopeProvider}:
 * - Production: KMS envelope (`PHI_ENVELOPE_PROVIDER=kms`) — env-only masters fail closed
 * - CI: `local-stub` fake KMS (no AWS call) with `ALLOW_PHI_KMS_STUB=1` when NODE_ENV=production
 * - Dev: `env-hmac` via `PHI_ENCRYPTION_KEY` still allowed outside production
 *
 * Per-institution DEKs:
 *   enc:v2 — HMAC(root, "phi:v2:{tenantId}:{institutionId}")  (legacy scoped)
 *   enc:v3 — HMAC(root, "phi:v3:{keyVersion}:{tenantId}:{institutionId}") (rotatable)
 *
 * Ciphertext formats:
 * - enc:v1:<iv>:<tag>:<data> — legacy global key
 * - enc:v2:<tenantId>:<institutionId>:<iv>:<tag>:<data>
 * - enc:v3:<keyVersion>:<tenantId>:<institutionId>:<iv>:<tag>:<data>
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import {
  activePhiKeyVersion,
  assertPhiEnvelopeConfigured,
  deriveInstitutionDek,
  PhiEnvelopeMisconfiguredError,
  PhiKeyMissingError,
  resolvePhiRootKeySync,
  type PhiCryptoScope,
  type PhiEnvelopeProvider,
} from './phi-envelope.js';

export type { PhiCryptoScope, PhiEnvelopeProvider };
export {
  assertPhiEnvelopeConfigured,
  createPhiEnvelopeProvider,
  ensurePhiEnvelopeProvider,
  getPhiEnvelopeProviderKind,
  LocalStubPhiKmsClient,
  PhiEnvelopeMisconfiguredError,
  PhiKeyMissingError,
  resetPhiEnvelopeProviderForTests,
  setPhiEnvelopeProviderForTests,
  plaintextPhiAllowed,
} from './phi-envelope.js';
export type { PhiKmsClient, PhiEnvelopeProviderKind } from './phi-envelope.js';

const PREFIX_V1 = 'enc:v1:';
const PREFIX_V2 = 'enc:v2:';
const PREFIX_V3 = 'enc:v3:';

/** @deprecated Prefer {@link assertPhiEnvelopeConfigured}. */
export function assertPhiKeyConfigured(env: NodeJS.ProcessEnv = process.env): void {
  assertPhiEnvelopeConfigured(env);
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
  try {
    return resolvePhiRootKeySync() != null;
  } catch {
    return Boolean(process.env.PHI_ENCRYPTION_KEY?.trim() || process.env.PHI_KMS_KEY_ID?.trim());
  }
}

/** True when `value` is an enc:v1/v2/v3 ciphertext (used by tests / migrations). */
export function isPhiCiphertext(value: string | null | undefined): boolean {
  return (
    typeof value === 'string' &&
    (value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V2) || value.startsWith(PREFIX_V3))
  );
}

function deriveScopedKeyV2(scope: PhiCryptoScope, root: Buffer): Buffer {
  // Legacy enc:v2 derivation (no key version) for backward compatibility.
  return createHmac('sha256', root)
    .update(`phi:v2:${scope.tenantId}:${scope.institutionId}`, 'utf8')
    .digest();
}

function deriveScopedKeyV3(scope: PhiCryptoScope, root: Buffer, keyVersion: string): Buffer {
  return deriveInstitutionDek(root, scope, keyVersion);
}

function parseV2Scope(
  body: string,
): { scope: PhiCryptoScope; ivB64: string; tagB64: string; dataB64: string } | null {
  const parts = body.split(':');
  if (parts.length !== 5) return null;
  const [tenantId, institutionId, ivB64, tagB64, dataB64] = parts;
  if (!tenantId || !institutionId || !ivB64 || !tagB64 || !dataB64) return null;
  return { scope: { tenantId, institutionId }, ivB64, tagB64, dataB64 };
}

function parseV3Scope(body: string): {
  keyVersion: string;
  scope: PhiCryptoScope;
  ivB64: string;
  tagB64: string;
  dataB64: string;
} | null {
  const parts = body.split(':');
  if (parts.length !== 6) return null;
  const [keyVersion, tenantId, institutionId, ivB64, tagB64, dataB64] = parts;
  if (!keyVersion || !tenantId || !institutionId || !ivB64 || !tagB64 || !dataB64) return null;
  return { keyVersion, scope: { tenantId, institutionId }, ivB64, tagB64, dataB64 };
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

function preferV3Writes(env: NodeJS.ProcessEnv = process.env): boolean {
  const kind = env.PHI_ENVELOPE_PROVIDER?.trim().toLowerCase();
  return kind === 'kms' || kind === 'local-stub' || Boolean(env.PHI_KMS_KEY_ID?.trim());
}

export function encryptPhi(
  plaintext: string | null | undefined,
  scope?: PhiCryptoScope,
): string | null {
  if (plaintext == null) return null;
  if (
    plaintext.startsWith(PREFIX_V1) ||
    plaintext.startsWith(PREFIX_V2) ||
    plaintext.startsWith(PREFIX_V3)
  ) {
    return plaintext;
  }

  const root = resolvePhiRootKeySync();
  if (!root) return plaintext;

  if (scope?.tenantId && scope.institutionId) {
    if (preferV3Writes()) {
      const keyVersion = activePhiKeyVersion();
      const key = deriveScopedKeyV3(scope, root, keyVersion);
      return encryptWithKey(
        plaintext,
        key,
        PREFIX_V3,
        `${keyVersion}:${scope.tenantId}:${scope.institutionId}`,
      );
    }
    const key = deriveScopedKeyV2(scope, root);
    return encryptWithKey(
      plaintext,
      key,
      PREFIX_V2,
      `${scope.tenantId}:${scope.institutionId}`,
    );
  }

  return encryptWithKey(plaintext, root, PREFIX_V1);
}

export function decryptPhi(
  value: string | null | undefined,
  scope?: PhiCryptoScope,
): string | null {
  if (value == null) return null;
  if (
    !value.startsWith(PREFIX_V1) &&
    !value.startsWith(PREFIX_V2) &&
    !value.startsWith(PREFIX_V3)
  ) {
    return value;
  }

  let root: Buffer | null;
  try {
    root = resolvePhiRootKeySync();
  } catch (err) {
    if (err instanceof PhiKeyMissingError || err instanceof PhiEnvelopeMisconfiguredError) throw err;
    throw err;
  }
  if (!root) {
    throw new Error('PHI encryption root key is required to decrypt enc:v1/v2/v3 payloads');
  }

  if (value.startsWith(PREFIX_V3)) {
    const parsed = parseV3Scope(value.slice(PREFIX_V3.length));
    if (!parsed) throw new Error('Invalid enc:v3 PHI ciphertext');
    if (
      scope &&
      (scope.tenantId !== parsed.scope.tenantId ||
        scope.institutionId !== parsed.scope.institutionId)
    ) {
      throw new Error('Invalid enc:v3 PHI ciphertext: institution scope mismatch');
    }
    const key = deriveScopedKeyV3(parsed.scope, root, parsed.keyVersion);
    return decryptAesGcm(parsed.ivB64, parsed.tagB64, parsed.dataB64, key, 'enc:v3');
  }

  if (value.startsWith(PREFIX_V2)) {
    const parsed = parseV2Scope(value.slice(PREFIX_V2.length));
    if (!parsed) throw new Error('Invalid enc:v2 PHI ciphertext');
    if (
      scope &&
      (scope.tenantId !== parsed.scope.tenantId ||
        scope.institutionId !== parsed.scope.institutionId)
    ) {
      throw new Error('Invalid enc:v2 PHI ciphertext: institution scope mismatch');
    }
    const key = deriveScopedKeyV2(parsed.scope, root);
    return decryptAesGcm(parsed.ivB64, parsed.tagB64, parsed.dataB64, key, 'enc:v2');
  }

  const body = value.slice(PREFIX_V1.length);
  const [ivB64, tagB64, dataB64] = body.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid enc:v1 PHI ciphertext');
  }
  return decryptAesGcm(ivB64, tagB64, dataB64, root, 'enc:v1');
}

function decryptAesGcm(
  ivB64: string,
  tagB64: string,
  dataB64: string,
  key: Buffer,
  label: string,
): string {
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(`Invalid ${label} PHI ciphertext`);
  }
}
