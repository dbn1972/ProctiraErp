/**
 * Manifest Validation Module
 *
 * Validates plugin manifests against the platform's manifest schema.
 * Used during development to catch issues before submission.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { PluginManifestSchema, type PluginManifest } from '@proctira/backend-plugin';

/**
 * Result of manifest validation.
 */
export interface ManifestValidationResult {
  /** Whether the manifest is valid */
  valid: boolean;
  /** Validation errors (empty if valid) */
  errors: ManifestValidationIssue[];
  /** Warnings that don't prevent registration but should be addressed */
  warnings: ManifestValidationIssue[];
}

/**
 * A single validation issue (error or warning).
 */
export interface ManifestValidationIssue {
  /** The field path that has the issue */
  path: string;
  /** Human-readable description of the issue */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning';
}

/**
 * Error thrown when manifest validation fails.
 */
export class ManifestValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ManifestValidationIssue[],
  ) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

/**
 * Validate a plugin manifest against the platform schema.
 *
 * Checks:
 * - Required fields are present
 * - Name follows kebab-case pattern (a-z0-9-)
 * - Version is valid semver
 * - supportedProductVersions is a valid semver range
 * - tenantScopeBehavior is 'isolated' or 'shared'
 * - Permissions and extension points are non-empty strings
 *
 * @param manifest - The manifest object to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * import { validateManifest } from '@proctira/plugin-sdk/manifest';
 *
 * const result = validateManifest(myManifest);
 * if (!result.valid) {
 *   console.error('Manifest errors:', result.errors);
 * }
 * ```
 */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  const errors: ManifestValidationIssue[] = [];
  const warnings: ManifestValidationIssue[] = [];

  // Check if manifest is an object
  if (!manifest || typeof manifest !== 'object') {
    errors.push({
      path: '',
      message: 'Manifest must be a non-null object',
      severity: 'error',
    });
    return { valid: false, errors, warnings };
  }

  // Validate against Typebox schema
  const isValid = Value.Check(PluginManifestSchema, manifest);

  if (!isValid) {
    const schemaErrors = [...Value.Errors(PluginManifestSchema, manifest)];
    for (const err of schemaErrors) {
      errors.push({
        path: err.path,
        message: err.message,
        severity: 'error',
      });
    }
  }

  // Additional semantic validations
  const m = manifest as Record<string, unknown>;

  // Warn if no permissions are required (unusual for most plugins)
  if (Array.isArray(m['requiredPermissions']) && m['requiredPermissions'].length === 0) {
    warnings.push({
      path: '/requiredPermissions',
      message:
        'Plugin declares no required permissions. Most plugins need at least read access to some entity.',
      severity: 'warning',
    });
  }

  // Warn if no extension points are required
  if (Array.isArray(m['requiredExtensionPoints']) && m['requiredExtensionPoints'].length === 0) {
    warnings.push({
      path: '/requiredExtensionPoints',
      message:
        'Plugin declares no required extension points. Consider declaring which hooks your plugin uses.',
      severity: 'warning',
    });
  }

  // Warn if auditBehavior is too short
  if (typeof m['auditBehavior'] === 'string' && m['auditBehavior'].length < 20) {
    warnings.push({
      path: '/auditBehavior',
      message:
        'auditBehavior description is very short. Provide a clear description of what actions are audited.',
      severity: 'warning',
    });
  }

  // Warn about shared tenant scope
  if (m['tenantScopeBehavior'] === 'shared') {
    warnings.push({
      path: '/tenantScopeBehavior',
      message:
        'Shared tenant scope requires additional security review. Most plugins should use "isolated".',
      severity: 'warning',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a manifest and throw if invalid.
 * Useful for CI/CD pipelines where you want to fail fast.
 */
export function validateManifestOrThrow(manifest: unknown): PluginManifest {
  const result = validateManifest(manifest);
  if (!result.valid) {
    throw new ManifestValidationError(
      `Plugin manifest validation failed with ${result.errors.length} error(s):\n` +
        result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n'),
      result.errors,
    );
  }
  return manifest as PluginManifest;
}
