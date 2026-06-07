/**
 * Unit tests for local-auth (password hashing and verification).
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './local-auth.js';

describe('local-auth', () => {
  describe('hashPassword', () => {
    it('should hash a password and return a bcrypt hash string', async () => {
      const password = 'SecureP@ss123';
      const hash = await hashPassword(password, 10); // Use lower rounds for test speed

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.startsWith('$2b$')).toBe(true);
    });

    it('should produce different hashes for the same password (due to salt)', async () => {
      const password = 'TestPassword!';
      const hash1 = await hashPassword(password, 10);
      const hash2 = await hashPassword(password, 10);

      expect(hash1).not.toBe(hash2);
    });

    it('should use the specified salt rounds', async () => {
      const password = 'Test123';
      const hash4 = await hashPassword(password, 4);
      const hash10 = await hashPassword(password, 10);

      // Both should be valid bcrypt hashes but with different cost factors
      expect(hash4).toContain('$2b$04$');
      expect(hash10).toContain('$2b$10$');
    });
  });

  describe('verifyPassword', () => {
    it('should return true for a correct password', async () => {
      const password = 'CorrectPassword!';
      const hash = await hashPassword(password, 10);

      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should return false for an incorrect password', async () => {
      const password = 'CorrectPassword!';
      const hash = await hashPassword(password, 10);

      const result = await verifyPassword('WrongPassword!', hash);
      expect(result).toBe(false);
    });

    it('should return false for an empty password against a valid hash', async () => {
      const hash = await hashPassword('SomePassword', 10);

      const result = await verifyPassword('', hash);
      expect(result).toBe(false);
    });

    it('should handle special characters in passwords', async () => {
      const password = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\';
      const hash = await hashPassword(password, 10);

      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should handle unicode characters in passwords', async () => {
      const password = '密码テスト🔐';
      const hash = await hashPassword(password, 10);

      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });
  });
});
