/**
 * Device-key hashing for GPS ingest (G-920).
 * Plaintext keys are returned once at registration and never stored.
 */
import { createHash, randomBytes } from 'node:crypto';

export function hashDeviceKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export function generateDeviceKey(): string {
  return randomBytes(24).toString('base64url');
}

export function generateDeviceId(): string {
  return `bus-${randomBytes(8).toString('hex')}`;
}
