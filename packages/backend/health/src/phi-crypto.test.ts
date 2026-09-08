/**
 * Unit tests for field-level PHI encryption (G-203).
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertPhiKeyConfigured,
  decryptPhi,
  encryptPhi,
  isPhiCiphertext,
  isPhiEncryptionEnabled,
  PhiKeyMissingError,
} from './phi-crypto.js';

describe('phi-crypto', () => {
  const previousKey = process.env.PHI_ENCRYPTION_KEY;
  const previousEnv = process.env.NODE_ENV;
  const previousAllow = process.env.ALLOW_PLAINTEXT_PHI;

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env.PHI_ENCRYPTION_KEY;
    } else {
      process.env.PHI_ENCRYPTION_KEY = previousKey;
    }
    process.env.NODE_ENV = previousEnv;
    if (previousAllow === undefined) delete process.env.ALLOW_PLAINTEXT_PHI;
    else process.env.ALLOW_PLAINTEXT_PHI = previousAllow;
  });

  // G-711 — fail closed in production
  it('throws in production when the key is missing (boot guard and first write)', () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.ALLOW_PLAINTEXT_PHI;
    process.env.NODE_ENV = 'production';
    expect(() => assertPhiKeyConfigured()).toThrow(PhiKeyMissingError);
    expect(() => encryptPhi('notes')).toThrow(PhiKeyMissingError);
    expect(() => decryptPhi('notes')).not.toThrow(); // plaintext legacy rows still readable
  });

  it('allows plaintext in production only with ALLOW_PLAINTEXT_PHI=1', () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PLAINTEXT_PHI = '1';
    expect(() => assertPhiKeyConfigured()).not.toThrow();
    expect(encryptPhi('notes')).toBe('notes');
  });

  it('does not throw in production when a key is configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.PHI_ENCRYPTION_KEY = 'b'.repeat(64);
    expect(() => assertPhiKeyConfigured()).not.toThrow();
    expect(isPhiCiphertext(encryptPhi('x'))).toBe(true);
    expect(isPhiCiphertext('x')).toBe(false);
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
