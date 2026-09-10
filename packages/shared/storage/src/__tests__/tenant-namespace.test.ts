import { describe, it, expect } from 'vitest';
import {
  buildTenantKey,
  buildTenantPrefix,
  extractTenantId,
  validateTenantOwnership,
} from '../tenant-namespace.js';

describe('tenant-namespace', () => {
  describe('buildTenantKey', () => {
    it('should build a namespaced key with tenant prefix', () => {
      const result = buildTenantKey('tenant-123', 'documents/report.pdf');
      expect(result).toBe('tenants/tenant-123/documents/report.pdf');
    });

    it('should handle UUID tenant IDs', () => {
      const result = buildTenantKey('550e8400-e29b-41d4-a716-446655440000', 'file.txt');
      expect(result).toBe('tenants/550e8400-e29b-41d4-a716-446655440000/file.txt');
    });

    it('should strip leading slashes from key', () => {
      const result = buildTenantKey('tenant-1', '/uploads/image.png');
      expect(result).toBe('tenants/tenant-1/uploads/image.png');
    });

    it('should strip multiple leading slashes from key', () => {
      const result = buildTenantKey('tenant-1', '///file.txt');
      expect(result).toBe('tenants/tenant-1/file.txt');
    });

    it('should throw if tenantId is empty', () => {
      expect(() => buildTenantKey('', 'file.txt')).toThrow('tenantId must not be empty');
    });

    it('should throw if tenantId is whitespace only', () => {
      expect(() => buildTenantKey('   ', 'file.txt')).toThrow('tenantId must not be empty');
    });

    it('should throw if key is empty', () => {
      expect(() => buildTenantKey('tenant-1', '')).toThrow('key must not be empty');
    });

    it('should throw if key is whitespace only', () => {
      expect(() => buildTenantKey('tenant-1', '   ')).toThrow('key must not be empty');
    });

    it('should trim trailing slashes from tenantId', () => {
      const result = buildTenantKey('tenant-1/', 'file.txt');
      expect(result).toBe('tenants/tenant-1/file.txt');
    });
  });

  describe('buildTenantPrefix', () => {
    it('should build a tenant prefix without sub-prefix', () => {
      const result = buildTenantPrefix('tenant-123');
      expect(result).toBe('tenants/tenant-123/');
    });

    it('should build a tenant prefix with sub-prefix', () => {
      const result = buildTenantPrefix('tenant-123', 'documents/');
      expect(result).toBe('tenants/tenant-123/documents/');
    });

    it('should strip leading slashes from sub-prefix', () => {
      const result = buildTenantPrefix('tenant-123', '/uploads');
      expect(result).toBe('tenants/tenant-123/uploads');
    });

    it('should throw if tenantId is empty', () => {
      expect(() => buildTenantPrefix('')).toThrow('tenantId must not be empty');
    });

    it('should handle empty string sub-prefix as no prefix', () => {
      const result = buildTenantPrefix('tenant-123', '');
      expect(result).toBe('tenants/tenant-123/');
    });
  });

  describe('extractTenantId', () => {
    it('should extract tenant ID from a namespaced key', () => {
      const result = extractTenantId('tenants/tenant-123/documents/file.pdf');
      expect(result).toBe('tenant-123');
    });

    it('should extract UUID tenant ID', () => {
      const result = extractTenantId('tenants/550e8400-e29b-41d4-a716-446655440000/file.txt');
      expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should return null for keys without tenant prefix', () => {
      const result = extractTenantId('other/path/file.txt');
      expect(result).toBeNull();
    });

    it('should return null for keys with insufficient parts', () => {
      const result = extractTenantId('tenants/');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = extractTenantId('');
      expect(result).toBeNull();
    });
  });

  describe('validateTenantOwnership', () => {
    it('should return true when key belongs to expected tenant', () => {
      const result = validateTenantOwnership('tenants/tenant-123/file.txt', 'tenant-123');
      expect(result).toBe(true);
    });

    it('should return false when key belongs to different tenant', () => {
      const result = validateTenantOwnership('tenants/tenant-123/file.txt', 'tenant-456');
      expect(result).toBe(false);
    });

    it('should return false for non-namespaced keys', () => {
      const result = validateTenantOwnership('random/file.txt', 'tenant-123');
      expect(result).toBe(false);
    });
  });
});
