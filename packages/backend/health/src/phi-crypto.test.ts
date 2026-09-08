/**
 * Unit tests for field-level PHI encryption (G-203).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { decryptPhi, encryptPhi, isPhiEncryptionEnabled } from './phi-crypto.js';

describe('phi-crypto', () => {
  const previousKey = process.env.PHI_ENCRYPTION_KEY;

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env.PHI_ENCRYPTION_KEY;
    } else {
      process.env.PHI_ENCRYPTION_KEY = previousKey;
    }
  });

  it('passes through plaintext when PHI_ENCRYPTION_KEY is unset', () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    expect(isPhiEncryptionEnabled()).toBe(false);
    expect(encryptPhi('sensitive findings')).toBe('sensitive findings');
    expect(decryptPhi('sensitive findings')).toBe('sensitive findings');
    expect(encryptPhi(null)).toBeNull();
    expect(decryptPhi(undefined)).toBeNull();
  });

  it('round-trips AES-GCM ciphertext when key is set', () => {
    process.env.PHI_ENCRYPTION_KEY = 'unit-test-phi-key-please-change';
    expect(isPhiEncryptionEnabled()).toBe(true);
    const cipher = encryptPhi('student diagnosis notes');
    expect(cipher).toMatch(/^enc:v1:/);
    expect(cipher).not.toContain('student diagnosis notes');
    expect(decryptPhi(cipher)).toBe('student diagnosis notes');
    // Idempotent re-encrypt of ciphertext
    expect(encryptPhi(cipher)).toBe(cipher);
  });

  it('accepts a 32-byte hex key', () => {
    process.env.PHI_ENCRYPTION_KEY = 'a'.repeat(64);
    const cipher = encryptPhi('hex-key-payload');
    expect(decryptPhi(cipher)).toBe('hex-key-payload');
  });
});
