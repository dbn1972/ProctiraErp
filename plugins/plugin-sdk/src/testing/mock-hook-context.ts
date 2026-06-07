/**
 * Mock Hook Context Factory
 *
 * Creates mock HookContext objects for testing plugin hook handlers.
 */
import type { HookContext } from '@proctira/backend-plugin';

/**
 * Options for creating a mock hook context.
 */
export interface MockHookContextOptions {
  tenantId?: string;
  actorId?: string;
  extensionPointId?: string;
  pluginInstallId?: string;
  correlationId?: string;
  timestamp?: Date;
}

/**
 * Create a mock HookContext for testing.
 *
 * @param options - Override default values
 * @returns A fully populated HookContext
 *
 * @example
 * ```typescript
 * import { mockHookContext } from '@proctira/plugin-sdk/testing';
 *
 * const context = mockHookContext({
 *   tenantId: 'my-tenant',
 *   actorId: 'user-123',
 * });
 * ```
 */
export function mockHookContext(options: MockHookContextOptions = {}): HookContext {
  return {
    tenantId: options.tenantId ?? 'test-tenant-001',
    actorId: options.actorId ?? 'test-user-001',
    extensionPointId: options.extensionPointId ?? 'test.extension-point',
    pluginInstallId: options.pluginInstallId ?? 'test-install-001',
    correlationId: options.correlationId ?? `test-corr-${Date.now()}`,
    timestamp: options.timestamp ?? new Date(),
  };
}
