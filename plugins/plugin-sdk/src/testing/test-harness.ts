/**
 * Plugin Test Harness
 *
 * Creates an isolated testing environment for plugin validation.
 * Simulates the platform runtime without requiring a full server.
 */
import type { PluginDefinition } from '../core/define-plugin.js';
import type { HookContext, HookResult, DomainEventPayload, ApprovedEvent } from '@proctira/backend-plugin';
import { validateManifest, type ManifestValidationResult } from '../manifest/index.js';
import { mockHookContext } from './mock-hook-context.js';
import { mockEventPayload } from './mock-event-payload.js';

/**
 * Options for creating a test harness.
 */
export interface TestHarnessOptions {
  /** Tenant ID to use in test contexts (default: 'test-tenant-001') */
  tenantId?: string;
  /** Actor ID to use in test contexts (default: 'test-user-001') */
  actorId?: string;
  /** Plugin configuration to pass to handlers */
  configuration?: Record<string, unknown>;
  /** Product version to validate compatibility against */
  productVersion?: string;
}

/**
 * The test harness instance providing methods to exercise plugin functionality.
 */
export interface TestHarness {
  /** The plugin definition being tested */
  plugin: PluginDefinition;
  /** Validate the plugin manifest */
  validateManifest(): ManifestValidationResult;
  /** Invoke a specific hook handler by extension point ID */
  invokeHook<TPayload = unknown, TResult = unknown>(
    extensionPointId: string,
    payload: TPayload,
    contextOverrides?: Partial<HookContext>,
  ): Promise<HookResult<TResult>>;
  /** Invoke an event handler by event type */
  invokeEventHandler(
    eventType: ApprovedEvent,
    eventData?: Record<string, unknown>,
    contextOverrides?: Partial<HookContext>,
  ): Promise<void>;
  /** Get all registered extension point IDs */
  getRegisteredHooks(): string[];
  /** Get all registered event types */
  getRegisteredEvents(): ApprovedEvent[];
  /** Check if the plugin declares a specific permission */
  requiresPermission(permission: string): boolean;
  /** Check if the plugin declares a specific extension point */
  requiresExtensionPoint(extensionPointId: string): boolean;
  /** Simulate the plugin enable lifecycle */
  simulateEnable(): Promise<void>;
  /** Simulate the plugin disable lifecycle */
  simulateDisable(): Promise<void>;
}

/**
 * Create a test harness for a plugin definition.
 *
 * The harness provides methods to invoke hooks, event handlers,
 * and validate the manifest without running a full platform instance.
 *
 * @param plugin - The plugin definition to test
 * @param options - Test harness configuration
 * @returns A test harness instance
 *
 * @example
 * ```typescript
 * import { createTestHarness } from '@proctira/plugin-sdk/testing';
 * import myPlugin from '../src/index';
 *
 * describe('My Plugin', () => {
 *   const harness = createTestHarness(myPlugin, {
 *     tenantId: 'test-tenant',
 *     configuration: { webhookUrl: 'https://example.com/hook' },
 *   });
 *
 *   it('should have a valid manifest', () => {
 *     const result = harness.validateManifest();
 *     expect(result.valid).toBe(true);
 *   });
 *
 *   it('should handle student.after-create hook', async () => {
 *     const result = await harness.invokeHook('student.after-create', {
 *       entityId: 'student-123',
 *       data: { name: 'John Doe' },
 *     });
 *     expect(result.success).toBe(true);
 *   });
 * });
 * ```
 */
export function createTestHarness(
  plugin: PluginDefinition,
  options: TestHarnessOptions = {},
): TestHarness {
  const {
    tenantId = 'test-tenant-001',
    actorId = 'test-user-001',
    configuration = {},
  } = options;

  return {
    plugin,

    validateManifest(): ManifestValidationResult {
      return validateManifest(plugin.manifest);
    },

    async invokeHook<TPayload = unknown, TResult = unknown>(
      extensionPointId: string,
      payload: TPayload,
      contextOverrides?: Partial<HookContext>,
    ): Promise<HookResult<TResult>> {
      const hookDef = plugin.hooks.find((h) => h.extensionPointId === extensionPointId);
      if (!hookDef) {
        throw new Error(
          `No hook registered for extension point '${extensionPointId}'. ` +
            `Registered hooks: ${plugin.hooks.map((h) => h.extensionPointId).join(', ') || 'none'}`,
        );
      }

      const context = mockHookContext({
        tenantId,
        actorId,
        extensionPointId,
        ...contextOverrides,
      });

      const startTime = Date.now();
      const result = await hookDef.handler(payload, context);
      const executionTimeMs = Date.now() - startTime;

      return {
        ...result,
        executionTimeMs: result.executionTimeMs ?? executionTimeMs,
      } as HookResult<TResult>;
    },

    async invokeEventHandler(
      eventType: ApprovedEvent,
      eventData?: Record<string, unknown>,
      contextOverrides?: Partial<HookContext>,
    ): Promise<void> {
      const handlerDef = plugin.eventHandlers.find((h) => h.eventType === eventType);
      if (!handlerDef) {
        throw new Error(
          `No event handler registered for event '${eventType}'. ` +
            `Registered events: ${plugin.eventHandlers.map((h) => h.eventType).join(', ') || 'none'}`,
        );
      }

      const context = mockHookContext({
        tenantId,
        actorId,
        extensionPointId: `event:${eventType}`,
        ...contextOverrides,
      });

      const event = mockEventPayload(eventType, {
        tenantId,
        actorId,
        data: eventData,
      });

      await handlerDef.handler(event, context);
    },

    getRegisteredHooks(): string[] {
      return plugin.hooks.map((h) => h.extensionPointId);
    },

    getRegisteredEvents(): ApprovedEvent[] {
      return plugin.eventHandlers.map((h) => h.eventType);
    },

    requiresPermission(permission: string): boolean {
      return plugin.manifest.requiredPermissions.includes(permission);
    },

    requiresExtensionPoint(extensionPointId: string): boolean {
      return plugin.manifest.requiredExtensionPoints.includes(extensionPointId);
    },

    async simulateEnable(): Promise<void> {
      if (plugin.onEnable) {
        await plugin.onEnable({
          tenantId,
          installId: 'test-install-001',
          configuration,
          logger: createTestLogger(),
        });
      }
    },

    async simulateDisable(): Promise<void> {
      if (plugin.onDisable) {
        await plugin.onDisable({
          tenantId,
          installId: 'test-install-001',
          configuration,
          logger: createTestLogger(),
        });
      }
    },
  };
}

function createTestLogger() {
  return {
    info: (message: string, _data?: Record<string, unknown>) => {
      /* no-op in tests */
    },
    warn: (message: string, _data?: Record<string, unknown>) => {
      /* no-op in tests */
    },
    error: (message: string, _data?: Record<string, unknown>) => {
      /* no-op in tests */
    },
    debug: (message: string, _data?: Record<string, unknown>) => {
      /* no-op in tests */
    },
  };
}
