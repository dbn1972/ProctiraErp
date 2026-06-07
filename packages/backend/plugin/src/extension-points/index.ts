/**
 * Extension Point Framework
 *
 * Provides a governed, versioned system for plugins to extend
 * platform behavior through:
 *
 * 1. **Hooks**: before-create, after-create, validation, notification,
 *    export, workflow-transition hooks that intercept platform operations
 *
 * 2. **UI Slots**: Frontend extension points where plugins can register
 *    components (dashboard widgets, detail tabs, navigation items, etc.)
 *
 * 3. **Event Subscriptions**: Approved domain events that plugins can
 *    subscribe to for reactive behavior (only pre-approved events)
 *
 * All extension points are:
 * - Versioned with semver
 * - Rated for stability (stable, beta, experimental, deprecated)
 * - Permission-gated (plugins must have required permissions)
 * - Documented with payload/return schemas
 *
 * Charter: Section 26.3 (Explicit Extension Points)
 */

// Core types
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
} from './types.js';

// Registry
export { ExtensionPointRegistry } from './extension-point-registry.js';
export type { InvokeHooksOptions } from './extension-point-registry.js';

// Built-in definitions
export {
  BUILT_IN_EXTENSION_POINTS,
  BUILT_IN_UI_SLOTS,
  BUILT_IN_EVENT_DEFINITIONS,
} from './built-in-definitions.js';
