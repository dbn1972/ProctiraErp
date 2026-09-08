/**
 * Field-level PHI encryption (G-203).
 *
 * AES-256-GCM with key from PHI_ENCRYPTION_KEY (32-byte base64 or hex, or
 * any utf8 string hashed via SHA-256). Ciphertext format: enc:v1:<iv>:<tag>:<data>
 * (all base64). When the key is unset, values pass through plaintext (dev/CI).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

function resolveKey(): Buffer | null {
  const raw = process.env.PHI_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    // fall through to hash
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function isPhiEncryptionEnabled(): boolean {
  return resolveKey() !== null;
}

export function encryptPhi(plaintext: string | null | undefined): string | null {
  if (plaintext == null) return null;
  const key = resolveKey();
  if (!key) return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptPhi(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.startsWith(PREFIX)) return value;
  const key = resolveKey();
  if (!key) {
    throw new Error('PHI_ENCRYPTION_KEY is required to decrypt enc:v1 payloads');
  }
  const body = value.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid enc:v1 PHI ciphertext');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
