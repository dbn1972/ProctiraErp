/**
 * Plugin Test Assertions
 *
 * Helper assertion functions for validating plugin behavior in tests.
 */
import type { HookResult, PluginManifest } from '@proctira/backend-plugin';
import { validateManifest } from '../manifest/index.js';

/**
 * Assert that a hook result indicates success.
 * Throws if the result is not successful.
 */
export function assertHookResult<T = unknown>(
  result: HookResult<T>,
  options?: {
    /** Expect the hook to have succeeded */
    success?: boolean;
    /** Expect no validation errors */
    noErrors?: boolean;
    /** Expect the hook did not abort */
    noAbort?: boolean;
    /** Maximum allowed execution time in ms */
    maxExecutionTimeMs?: number;
  },
): void {
  const opts = {
    success: true,
    noErrors: true,
    noAbort: true,
    ...options,
  };

  if (opts.success && !result.success) {
    throw new Error(
      `Expected hook to succeed but it failed. ` +
        (result.errors ? `Errors: ${JSON.stringify(result.errors)}` : '') +
        (result.abortReason ? `Abort reason: ${result.abortReason}` : ''),
    );
  }

  if (!opts.success && result.success) {
    throw new Error('Expected hook to fail but it succeeded');
  }

  if (opts.noErrors && result.errors && result.errors.length > 0) {
    throw new Error(
      `Expected no validation errors but got ${result.errors.length}: ` +
        JSON.stringify(result.errors),
    );
  }

  if (opts.noAbort && result.abort) {
    throw new Error(`Expected hook not to abort but it did: ${result.abortReason}`);
  }

  if (opts.maxExecutionTimeMs !== undefined && result.executionTimeMs > opts.maxExecutionTimeMs) {
    throw new Error(
      `Hook execution time ${result.executionTimeMs}ms exceeded maximum ${opts.maxExecutionTimeMs}ms`,
    );
  }
}

/**
 * Assert that a plugin manifest is valid.
 * Throws with detailed error messages if validation fails.
 */
export function assertPluginManifest(manifest: unknown): void {
  const result = validateManifest(manifest);
  if (!result.valid) {
    throw new Error(
      `Plugin manifest is invalid:\n` +
        result.errors.map((e) => `  [${e.path}] ${e.message}`).join('\n'),
    );
  }
}
