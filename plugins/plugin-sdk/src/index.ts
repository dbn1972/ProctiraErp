/**
 * @proctira/plugin-sdk - Plugin Development SDK
 *
 * The official SDK for building plugins for the ProctiraERP platform.
 * Provides:
 * - Plugin definition helpers (definePlugin, defineHook, defineEventHandler)
 * - Manifest schema and validation
 * - Testing harness for plugin validation
 * - Local development workflow utilities
 *
 * @example
 * ```typescript
 * import { definePlugin, defineHook } from '@proctira/plugin-sdk';
 *
 * export default definePlugin({
 *   manifest: {
 *     name: 'my-plugin',
 *     owner: 'my-org',
 *     version: '1.0.0',
 *     supportedProductVersions: '>=1.0.0 <2.0.0',
 *     requiredPermissions: ['student.read'],
 *     requiredExtensionPoints: ['student.after-create'],
 *     tenantScopeBehavior: 'isolated',
 *     auditBehavior: 'All student creation events are logged',
 *     runtimeDependencies: [],
 *   },
 *   hooks: [
 *     defineHook('student.after-create', async (payload, context) => {
 *       // Handle student creation
 *       return { success: true, executionTimeMs: 0 };
 *     }),
 *   ],
 * });
 * ```
 */

// Core plugin definition
export { definePlugin } from './core/define-plugin.js';
export type { PluginDefinition, PluginConfig } from './core/define-plugin.js';

// Hook helpers
export { defineHook } from './core/define-hook.js';
export type { HookDefinition } from './core/define-hook.js';

// Event handler helpers
export { defineEventHandler } from './core/define-event-handler.js';
export type { EventHandlerDefinition } from './core/define-event-handler.js';

// UI Slot helpers
export { defineUISlot } from './core/define-ui-slot.js';
export type { UISlotComponentDefinition } from './core/define-ui-slot.js';

// Manifest
export { validateManifest, ManifestValidationError } from './manifest/index.js';
export type { ManifestValidationResult } from './manifest/index.js';

// Re-export key types from @proctira/backend-plugin for convenience
export type {
  PluginManifest,
  HookType,
  HookContext,
  HookResult,
  HookValidationError,
  ApprovedEvent,
  DomainEventPayload,
  StabilityRating,
  UISlotLocation,
  ResourceQuota,
  SandboxExecutionContext,
} from '@proctira/backend-plugin';
