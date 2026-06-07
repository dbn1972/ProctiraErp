/**
 * Plugin Definition
 *
 * The primary entry point for defining an ProctiraERP plugin.
 * Provides type-safe plugin configuration with manifest, hooks,
 * event handlers, and UI slot registrations.
 */
import type { PluginManifest } from '@proctira/backend-plugin';
import type { HookDefinition } from './define-hook.js';
import type { EventHandlerDefinition } from './define-event-handler.js';
import type { UISlotComponentDefinition } from './define-ui-slot.js';

/**
 * Configuration object for defining a plugin.
 */
export interface PluginConfig {
  /** The plugin manifest describing metadata, permissions, and compatibility */
  manifest: PluginManifest;
  /** Hook handlers that respond to extension points */
  hooks?: HookDefinition[];
  /** Event handlers that respond to domain events */
  eventHandlers?: EventHandlerDefinition[];
  /** UI slot component registrations */
  uiSlots?: UISlotComponentDefinition[];
  /** Plugin initialization function called when the plugin is enabled */
  onEnable?: (context: PluginLifecycleContext) => Promise<void>;
  /** Plugin teardown function called when the plugin is disabled */
  onDisable?: (context: PluginLifecycleContext) => Promise<void>;
}

/**
 * Context provided during plugin lifecycle events (enable/disable).
 */
export interface PluginLifecycleContext {
  /** The tenant ID this plugin is installed for */
  tenantId: string;
  /** The plugin installation ID */
  installId: string;
  /** Configuration provided by the tenant admin */
  configuration: Record<string, unknown>;
  /** Logger scoped to this plugin */
  logger: PluginLogger;
}

/**
 * Logger interface available to plugins.
 */
export interface PluginLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * The fully resolved plugin definition returned by definePlugin.
 */
export interface PluginDefinition {
  /** The plugin manifest */
  manifest: PluginManifest;
  /** Registered hook handlers */
  hooks: HookDefinition[];
  /** Registered event handlers */
  eventHandlers: EventHandlerDefinition[];
  /** Registered UI slot components */
  uiSlots: UISlotComponentDefinition[];
  /** Lifecycle callbacks */
  onEnable?: (context: PluginLifecycleContext) => Promise<void>;
  onDisable?: (context: PluginLifecycleContext) => Promise<void>;
}

/**
 * Define an ProctiraERP plugin.
 *
 * This is the main entry point for plugin authors. It validates the
 * configuration structure and returns a typed plugin definition that
 * the platform can load and execute.
 *
 * @param config - The plugin configuration
 * @returns A fully resolved plugin definition
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@proctira/plugin-sdk';
 *
 * export default definePlugin({
 *   manifest: {
 *     name: 'attendance-notifier',
 *     owner: 'my-org',
 *     version: '1.0.0',
 *     supportedProductVersions: '>=1.0.0 <2.0.0',
 *     requiredPermissions: ['attendance.read', 'notification.send'],
 *     requiredExtensionPoints: ['attendance.after-create'],
 *     tenantScopeBehavior: 'isolated',
 *     auditBehavior: 'Logs all notification sends',
 *     runtimeDependencies: [],
 *   },
 *   hooks: [...],
 *   eventHandlers: [...],
 * });
 * ```
 */
export function definePlugin(config: PluginConfig): PluginDefinition {
  if (!config.manifest) {
    throw new Error('Plugin manifest is required');
  }
  if (!config.manifest.name) {
    throw new Error('Plugin manifest.name is required');
  }
  if (!config.manifest.version) {
    throw new Error('Plugin manifest.version is required');
  }

  return {
    manifest: config.manifest,
    hooks: config.hooks ?? [],
    eventHandlers: config.eventHandlers ?? [],
    uiSlots: config.uiSlots ?? [],
    onEnable: config.onEnable,
    onDisable: config.onDisable,
  };
}
