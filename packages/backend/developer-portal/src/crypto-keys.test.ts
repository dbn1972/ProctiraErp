/**
 * P0-11: cryptographic API key generation + webhook HMAC verify/reject.
 */
import { createHmac } from 'node:crypto';

import { describe, it, expect } from 'vitest';

import {
  generateApiKey,
  hashApiKey,
  generateWebhookSignature,
  verifyWebhookSignature,
} from './developer-portal-service.js';

describe('developer-portal crypto (P0-11)', () => {
  describe('generateApiKey', () => {
    it('returns oem_ prefix + 32 hex chars from CSPRNG', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^oem_[0-9a-f]{32}$/);
    });

    it('produces unique keys across calls', () => {
      const keys = new Set(Array.from({ length: 40 }, () => generateApiKey()));
      expect(keys.size).toBe(40);
    });
  });

  describe('hashApiKey', () => {
    it('returns stable sha256 digest prefix', () => {
      const key = 'oem_0123456789abcdef0123456789abcdef';
      const a = hashApiKey(key);
      const b = hashApiKey(key);
      expect(a).toBe(b);
      expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('differs for different keys', () => {
      expect(hashApiKey('oem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).not.toBe(
        hashApiKey('oem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      );
    });
  });

  describe('generateWebhookSignature / verifyWebhookSignature', () => {
    const secret = 'whsec_test_secret_do_not_use_in_prod';
    const payload = JSON.stringify({ event: 'student.created', id: 'stu-1' });

    it('generates sha256=<hex> HMAC matching Node createHmac', () => {
      const sig = generateWebhookSignature(payload, secret);
      const expectedHex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
      expect(sig).toBe(`sha256=${expectedHex}`);
      expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it('verifies a valid signature', () => {
      const sig = generateWebhookSignature(payload, secret);
      expect(verifyWebhookSignature(payload, secret, sig)).toBe(true);
    });

    it('rejects tampered payload', () => {
      const sig = generateWebhookSignature(payload, secret);
      expect(verifyWebhookSignature(payload + ' ', secret, sig)).toBe(false);
    });

    it('rejects wrong secret', () => {
      const sig = generateWebhookSignature(payload, secret);
      expect(verifyWebhookSignature(payload, 'other-secret', sig)).toBe(false);
    });

    it('rejects tampered signature hex', () => {
      const sig = generateWebhookSignature(payload, secret);
      const flipped = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
      expect(verifyWebhookSignature(payload, secret, flipped)).toBe(false);
    });

    it('rejects missing or malformed signature', () => {
      expect(verifyWebhookSignature(payload, secret, '')).toBe(false);
      expect(verifyWebhookSignature(payload, secret, 'md5=deadbeef')).toBe(false);
      expect(verifyWebhookSignature(payload, secret, 'sha256=short')).toBe(false);
    });
  });
});
