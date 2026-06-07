/**
 * Tests for manifest validation
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, validateManifestOrThrow, ManifestValidationError } from './index.js';

const validManifest = {
  name: 'test-plugin',
  owner: 'test-org',
  version: '1.0.0',
  supportedProductVersions: '>=1.0.0 <2.0.0',
  requiredPermissions: ['student.read'],
  requiredExtensionPoints: ['student.after-create'],
  tenantScopeBehavior: 'isolated',
  auditBehavior: 'Logs all operations performed by this plugin for audit compliance',
  runtimeDependencies: [],
};

describe('validateManifest', () => {
  it('should pass for a valid manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail for null input', () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should fail for non-object input', () => {
    const result = validateManifest('not-an-object');
    expect(result.valid).toBe(false);
  });

  it('should fail if name is missing', () => {
    const { name, ...noName } = validManifest;
    const result = validateManifest(noName);
    expect(result.valid).toBe(false);
  });

  it('should fail if name has invalid characters', () => {
    const result = validateManifest({ ...validManifest, name: 'Invalid Name!' });
    expect(result.valid).toBe(false);
  });

  it('should fail if version is not valid semver', () => {
    const result = validateManifest({ ...validManifest, version: 'not-semver' });
    expect(result.valid).toBe(false);
  });

  it('should fail if tenantScopeBehavior is invalid', () => {
    const result = validateManifest({ ...validManifest, tenantScopeBehavior: 'invalid' });
    expect(result.valid).toBe(false);
  });

  it('should warn if no permissions are declared', () => {
    const result = validateManifest({ ...validManifest, requiredPermissions: [] });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.path === '/requiredPermissions')).toBe(true);
  });

  it('should warn if no extension points are declared', () => {
    const result = validateManifest({ ...validManifest, requiredExtensionPoints: [] });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.path === '/requiredExtensionPoints')).toBe(true);
  });

  it('should warn if auditBehavior is too short', () => {
    const result = validateManifest({ ...validManifest, auditBehavior: 'Short' });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.path === '/auditBehavior')).toBe(true);
  });

  it('should warn for shared tenant scope', () => {
    const result = validateManifest({ ...validManifest, tenantScopeBehavior: 'shared' });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.path === '/tenantScopeBehavior')).toBe(true);
  });
});

describe('validateManifestOrThrow', () => {
  it('should return manifest for valid input', () => {
    const result = validateManifestOrThrow(validManifest);
    expect(result.name).toBe('test-plugin');
  });

  it('should throw ManifestValidationError for invalid input', () => {
    expect(() => validateManifestOrThrow({})).toThrow(ManifestValidationError);
  });

  it('should include issues in the error', () => {
    try {
      validateManifestOrThrow({});
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestValidationError);
      expect((error as ManifestValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});
