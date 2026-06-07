/**
 * @proctira/backend-plugin - Plugin Architecture Service
 *
 * Provides plugin lifecycle management with:
 * - Plugin registry (register, list, get)
 * - Plugin installation per tenant (install, enable, disable, uninstall)
 * - Manifest validation (name, version, permissions, compatibility)
 * - Compatibility checking against product version (semver range)
 * - Permission model (reviewable, consented, revocable, auditable)
 * - Audit logging for all lifecycle operations
 *
 * Storage tables: plugin_plugins, plugin_installs, plugin_permissions, plugin_manifests
 */

// Plugin
export { pluginPlugin } from './plugin-plugin.js';
export type { PluginPluginOptions } from './plugin-plugin.js';

// Service
export { PluginService } from './plugin-service.js';
export type { PluginServiceConfig } from './plugin-service.js';

// Repository
export type {
  PluginEntity,
  PluginManifestEntity,
  PluginInstallEntity,
  PluginPermissionEntity,
  PluginAuditEntry,
  PluginFilter,
  PluginRepository,
} from './plugin-repository.js';

// In-memory repository (for testing)
export { InMemoryPluginRepository } from './in-memory-repository.js';

// Schemas
export {
  PluginManifestSchema,
  TenantScopeBehaviorSchema,
  RegisterPluginSchema,
  InstallPluginSchema,
  PluginInstallParamsSchema,
  UninstallPluginSchema,
  PluginParamsSchema,
  PluginListQuerySchema,
  PluginResponseSchema,
  PluginInstallResponseSchema,
} from './schemas.js';
export type {
  PluginManifest,
  RegisterPluginInput,
  InstallPluginInput,
  PluginInstallParams,
  UninstallPluginInput,
  PluginParams,
  PluginListQuery,
  PluginResponse,
  PluginInstallResponse,
} from './schemas.js';

// Routes
export { registerPluginRoutes } from './routes.js';
export type { PluginRoutesOptions } from './routes.js';

// Compatibility
export {
  checkCompatibility,
  validateCompatibility,
  parseSemver,
  compareSemver,
} from './compatibility.js';
export type { CompatibilityResult } from './compatibility.js';

// Extension Point Framework
export {
  ExtensionPointRegistry,
  BUILT_IN_EXTENSION_POINTS,
  BUILT_IN_UI_SLOTS,
  BUILT_IN_EVENT_DEFINITIONS,
} from './extension-points/index.js';
export type {
  StabilityRating,
  HookType,
  ExtensionPointDefinition,
  HookContext,
  HookResult,
  HookValidationError,
  HookHandler,
  HookRegistration,
  UISlotLocation,
  UISlotDefinition,
  UISlotRegistration,
  ApprovedEvent,
  EventSubscriptionDefinition,
  EventSubscription,
  DomainEventPayload,
  EventHandler,
  InvokeHooksOptions,
} from './extension-points/index.js';

// Sandbox Runtime
export { PluginSandbox, InProcessSandbox, DEFAULT_RESOURCE_QUOTA } from './sandbox/index.js';
export type {
  ResourceQuota,
  SandboxExecutionContext,
  SandboxExecutionResult,
  SandboxOptions,
  SandboxAuditRecord,
  SandboxViolation,
} from './sandbox/index.js';
