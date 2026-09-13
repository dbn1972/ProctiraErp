/**
 * W1-SEC-04 (D7) — institution-scoped PHI keys must not share a single global DEK.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  decryptPhi,
  encryptPhi,
  isPhiCiphertext,
  type PhiCryptoScope,
} from './phi-crypto.js';

describe('W1-SEC-04 (D7) institution-scoped PHI crypto', () => {
  const previousKey = process.env.PHI_ENCRYPTION_KEY;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
    else process.env.PHI_ENCRYPTION_KEY = previousKey;
  });

  const scopeA: PhiCryptoScope = {
    tenantId: '550e8400-e29b-41d4-a716-446655440000',
    institutionId: '11111111-1111-4111-8111-111111111111',
  };
  const scopeB: PhiCryptoScope = {
    tenantId: scopeA.tenantId,
    institutionId: '22222222-2222-4222-8222-222222222222',
  };

  it('uses enc:v2 and different ciphertext per institution for the same plaintext', () => {
    process.env.PHI_ENCRYPTION_KEY = 'w1-sec-04-scoped-master-key';
    const plain = 'same counselling note body';
    const cipherA = encryptPhi(plain, scopeA);
    const cipherB = encryptPhi(plain, scopeB);
    expect(cipherA).toMatch(/^enc:v2:/);
    expect(cipherB).toMatch(/^enc:v2:/);
    expect(cipherA).not.toBe(cipherB);
    expect(isPhiCiphertext(cipherA)).toBe(true);
  });

  it('decrypts only with the matching institution scope', () => {
    process.env.PHI_ENCRYPTION_KEY = 'w1-sec-04-scoped-master-key';
    const cipher = encryptPhi('scoped secret', scopeA);
    expect(decryptPhi(cipher, scopeA)).toBe('scoped secret');
    expect(() => decryptPhi(cipher, scopeB)).toThrow(/Invalid enc:v2 PHI ciphertext|authentication tag/i);
  });

  it('still decrypts legacy enc:v1 ciphertext without scope', () => {
    process.env.PHI_ENCRYPTION_KEY = 'legacy-global-key-for-v1-test';
    const legacy = encryptPhi('legacy row');
    expect(legacy).toMatch(/^enc:v1:/);
    expect(decryptPhi(legacy)).toBe('legacy row');
  });
});
