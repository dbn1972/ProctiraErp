/**
 * Unit tests for field-level PHI encryption (G-203 / W1-SEC-04).
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertPhiKeyConfigured,
  decryptPhi,
  encryptPhi,
  isPhiCiphertext,
  isPhiEncryptionEnabled,
  PhiEnvelopeMisconfiguredError,
  PhiKeyMissingError,
  resetPhiEnvelopeProviderForTests,
} from './phi-crypto.js';

describe('phi-crypto', () => {
  const previousKey = process.env.PHI_ENCRYPTION_KEY;
  const previousEnv = process.env.NODE_ENV;
  const previousAllow = process.env.ALLOW_PLAINTEXT_PHI;
  const previousProvider = process.env.PHI_ENVELOPE_PROVIDER;
  const previousKms = process.env.PHI_KMS_KEY_ID;
  const previousStub = process.env.ALLOW_PHI_KMS_STUB;

  afterEach(() => {
    resetPhiEnvelopeProviderForTests();
    if (previousKey === undefined) {
      delete process.env.PHI_ENCRYPTION_KEY;
    } else {
      process.env.PHI_ENCRYPTION_KEY = previousKey;
    }
    process.env.NODE_ENV = previousEnv;
    if (previousAllow === undefined) delete process.env.ALLOW_PLAINTEXT_PHI;
    else process.env.ALLOW_PLAINTEXT_PHI = previousAllow;
    if (previousProvider === undefined) delete process.env.PHI_ENVELOPE_PROVIDER;
    else process.env.PHI_ENVELOPE_PROVIDER = previousProvider;
    if (previousKms === undefined) delete process.env.PHI_KMS_KEY_ID;
    else process.env.PHI_KMS_KEY_ID = previousKms;
    if (previousStub === undefined) delete process.env.ALLOW_PHI_KMS_STUB;
    else process.env.ALLOW_PHI_KMS_STUB = previousStub;
  });

  // G-711 — fail closed in production
  it('throws in production when the key is missing (boot guard and first write)', () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.ALLOW_PLAINTEXT_PHI;
    delete process.env.PHI_ENVELOPE_PROVIDER;
    delete process.env.PHI_KMS_KEY_ID;
    process.env.NODE_ENV = 'production';
    expect(() => assertPhiKeyConfigured()).toThrow(PhiKeyMissingError);
    expect(() => encryptPhi('notes')).toThrow(PhiKeyMissingError);
    expect(() => decryptPhi('notes')).not.toThrow(); // plaintext legacy rows still readable
  });

  it('allows plaintext in production only with ALLOW_PLAINTEXT_PHI=1', () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.PHI_ENVELOPE_PROVIDER;
    delete process.env.PHI_KMS_KEY_ID;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PLAINTEXT_PHI = '1';
    expect(() => assertPhiKeyConfigured()).not.toThrow();
    expect(encryptPhi('notes')).toBe('notes');
  });

  it('refuses silent env-only master in production (W1-SEC-04 COMPLETE)', () => {
    process.env.NODE_ENV = 'production';
    process.env.PHI_ENCRYPTION_KEY = 'b'.repeat(64);
    delete process.env.ALLOW_PLAINTEXT_PHI;
    delete process.env.PHI_ENVELOPE_PROVIDER;
    delete process.env.PHI_KMS_KEY_ID;
    delete process.env.ALLOW_PHI_KMS_STUB;
    expect(() => assertPhiKeyConfigured()).toThrow(PhiEnvelopeMisconfiguredError);
  });

  it('passes through plaintext when PHI_ENCRYPTION_KEY is unset', () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.PHI_ENVELOPE_PROVIDER;
    delete process.env.PHI_KMS_KEY_ID;
    process.env.NODE_ENV = 'test';
    expect(isPhiEncryptionEnabled()).toBe(false);
    expect(encryptPhi('sensitive findings')).toBe('sensitive findings');
    expect(decryptPhi('sensitive findings')).toBe('sensitive findings');
    expect(encryptPhi(null)).toBeNull();
    expect(decryptPhi(undefined)).toBeNull();
  });

  it('round-trips AES-GCM ciphertext when key is set', () => {
    process.env.NODE_ENV = 'test';
    process.env.PHI_ENCRYPTION_KEY = 'unit-test-phi-key-please-change';
    delete process.env.PHI_ENVELOPE_PROVIDER;
    expect(isPhiEncryptionEnabled()).toBe(true);
    const cipher = encryptPhi('student diagnosis notes');
    expect(cipher).toMatch(/^enc:v1:/);
    expect(cipher).not.toContain('student diagnosis notes');
    expect(decryptPhi(cipher)).toBe('student diagnosis notes');
    // Idempotent re-encrypt of ciphertext
    expect(encryptPhi(cipher)).toBe(cipher);
  });

  it('accepts a 32-byte hex key', () => {
    process.env.NODE_ENV = 'test';
    process.env.PHI_ENCRYPTION_KEY = 'a'.repeat(64);
    delete process.env.PHI_ENVELOPE_PROVIDER;
    const cipher = encryptPhi('hex-key-payload');
    expect(decryptPhi(cipher)).toBe('hex-key-payload');
    expect(isPhiCiphertext(cipher)).toBe(true);
    expect(isPhiCiphertext('x')).toBe(false);
  });
});
