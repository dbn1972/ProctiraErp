/**
 * Extension Point Framework - Core Types
 *
 * Defines the type system for the extension point framework.
 * Extension points are explicit, versioned, and governed contracts
 * that plugins can hook into to extend platform behavior.
 *
 * Charter: Section 26.3 (Explicit Extension Points)
 */

// ─── Stability Ratings ──────────────────────────────────────────────────────

/**
 * Stability rating for an extension point.
 * - stable: Guaranteed backward-compatible within major version
 * - beta: May change in minor versions with deprecation notice
 * - experimental: May change or be removed without notice
 * - deprecated: Scheduled for removal in a future version
 */
export type StabilityRating = 'stable' | 'beta' | 'experimental' | 'deprecated';

// ─── Hook Types ─────────────────────────────────────────────────────────────

/**
 * Supported hook types in the extension point framework.
 */
export type HookType =
  | 'before-create'
  | 'after-create'
  | 'before-update'
  | 'after-update'
  | 'before-delete'
  | 'after-delete'
  | 'validation'
  | 'notification'
  | 'export'
  | 'workflow-transition';

// ─── Extension Point Definition ─────────────────────────────────────────────

/**
 * Metadata describing an extension point.
 */
export interface ExtensionPointDefinition {
  /** Unique identifier for the extension point (e.g., "student.before-create") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Detailed description of what this extension point does */
  description: string;
  /** The hook type category */
  hookType: HookType;
  /** The entity/module this extension point belongs to */
  entityType: string;
  /** Semantic version of this extension point (e.g., "1.0.0") */
  version: string;
  /** Stability rating */
  stability: StabilityRating;
  /** Permissions required to subscribe to this extension point */
  requiredPermissions: string[];
  /** Description of the payload passed to hook handlers */
  payloadSchema: Record<string, unknown>;
  /** Description of the expected return value (if any) */
  returnSchema: Record<string, unknown> | null;
  /** Whether the hook can modify the payload (mutable) or is read-only */
  mutable: boolean;
  /** Whether the hook is synchronous (blocks execution) or async (fire-and-forget) */
  synchronous: boolean;
  /** Maximum execution time in milliseconds before timeout */
  timeoutMs: number;
  /** Date when this extension point was introduced */
  introducedIn: string;
  /** Date when this extension point was deprecated (if applicable) */
  deprecatedIn: string | null;
  /** Replacement extension point ID (if deprecated) */
  replacedBy: string | null;
}

// ─── Hook Handler ───────────────────────────────────────────────────────────

/**
 * Context passed to every hook handler invocation.
 */
export interface HookContext {
  /** Tenant ID for the current operation */
  tenantId: string;
  /** User ID of the actor triggering the hook */
  actorId: string;
  /** The extension point being invoked */
  extensionPointId: string;
  /** The plugin installation ID that registered this handler */
  pluginInstallId: string;
  /** Correlation ID for tracing */
  correlationId: string;
  /** Timestamp of invocation */
  timestamp: Date;
}

/**
 * Result returned by a hook handler.
 */
export interface HookResult<T = unknown> {
  /** Whether the handler executed successfully */
  success: boolean;
  /** Modified data (for mutable hooks) */
  data?: T;
  /** Validation errors (for validation hooks) */
  errors?: HookValidationError[];
  /** Whether to abort the operation (for before-* hooks) */
  abort?: boolean;
  /** Reason for aborting */
  abortReason?: string;
  /** Execution time in milliseconds */
  executionTimeMs: number;
}

/**
 * Validation error returned by a validation hook.
 */
export interface HookValidationError {
  /** Field path that failed validation */
  field: string;
  /** Error message */
  message: string;
  /** Error code for programmatic handling */
  code: string;
}

/**
 * A registered hook handler function.
 */
export type HookHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  context: HookContext,
) => Promise<HookResult<TResult>>;

// ─── Hook Registration ──────────────────────────────────────────────────────

/**
 * A registered hook subscription linking a plugin to an extension point.
 */
export interface HookRegistration {
  /** Unique registration ID */
  id: string;
  /** The extension point this hook subscribes to */
  extensionPointId: string;
  /** The plugin ID that registered this hook */
  pluginId: string;
  /** The plugin installation ID (tenant-scoped) */
  pluginInstallId: string;
  /** Tenant ID */
  tenantId: string;
  /** Priority (lower = earlier execution, default 100) */
  priority: number;
  /** Whether this registration is currently active */
  enabled: boolean;
  /** The handler function reference */
  handler: HookHandler;
  /** Registration timestamp */
  registeredAt: Date;
}

// ─── UI Slot Types ──────────────────────────────────────────────────────────

/**
 * Supported UI slot locations in the frontend.
 */
export type UISlotLocation =
  | 'dashboard-widget'
  | 'entity-detail-tab'
  | 'entity-detail-sidebar'
  | 'entity-list-action'
  | 'navigation-menu-item'
  | 'settings-panel'
  | 'report-section'
  | 'form-section';

/**
 * Definition of a UI extension slot.
 */
export interface UISlotDefinition {
  /** Unique slot identifier (e.g., "student-detail.sidebar") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of where this slot appears */
  description: string;
  /** The location category */
  location: UISlotLocation;
  /** The entity/module context */
  entityType: string;
  /** Version of this slot definition */
  version: string;
  /** Stability rating */
  stability: StabilityRating;
  /** Permissions required to register a component in this slot */
  requiredPermissions: string[];
  /** Maximum number of components that can be registered in this slot */
  maxRegistrations: number;
  /** Props schema passed to the registered component */
  propsSchema: Record<string, unknown>;
}

/**
 * A registered UI slot component from a plugin.
 */
export interface UISlotRegistration {
  /** Unique registration ID */
  id: string;
  /** The UI slot this component is registered in */
  slotId: string;
  /** The plugin ID */
  pluginId: string;
  /** The plugin installation ID (tenant-scoped) */
  pluginInstallId: string;
  /** Tenant ID */
  tenantId: string;
  /** Display order within the slot (lower = first) */
  order: number;
  /** Whether this registration is currently active */
  enabled: boolean;
  /** Component identifier (used by frontend to load the component) */
  componentId: string;
  /** Component label shown in the UI */
  label: string;
  /** Optional icon identifier */
  icon: string | null;
  /** Registration timestamp */
  registeredAt: Date;
}

// ─── Event Subscription Types ───────────────────────────────────────────────

/**
 * Approved domain events that plugins can subscribe to.
 */
export type ApprovedEvent =
  | 'student.created'
  | 'student.updated'
  | 'student.transferred'
  | 'student.enrolled'
  | 'student.graduated'
  | 'staff.created'
  | 'staff.updated'
  | 'staff.assigned'
  | 'institution.created'
  | 'institution.updated'
  | 'institution.deactivated'
  | 'enrollment.created'
  | 'enrollment.status-changed'
  | 'attendance.recorded'
  | 'attendance.threshold-exceeded'
  | 'assessment.result-entered'
  | 'assessment.grade-calculated'
  | 'examination.result-published'
  | 'workflow.transitioned'
  | 'workflow.escalated'
  | 'notification.sent'
  | 'notification.delivered'
  | 'report.generated'
  | 'import.completed'
  | 'export.completed';

/**
 * Definition of an event subscription point.
 */
export interface EventSubscriptionDefinition {
  /** The event type identifier */
  eventType: ApprovedEvent;
  /** Human-readable name */
  name: string;
  /** Description of when this event fires */
  description: string;
  /** Version of this event definition */
  version: string;
  /** Stability rating */
  stability: StabilityRating;
  /** Permissions required to subscribe */
  requiredPermissions: string[];
  /** Schema of the event payload */
  payloadSchema: Record<string, unknown>;
  /** The entity type that emits this event */
  entityType: string;
}

/**
 * A plugin's subscription to a domain event.
 */
export interface EventSubscription {
  /** Unique subscription ID */
  id: string;
  /** The event type subscribed to */
  eventType: ApprovedEvent;
  /** The plugin ID */
  pluginId: string;
  /** The plugin installation ID (tenant-scoped) */
  pluginInstallId: string;
  /** Tenant ID */
  tenantId: string;
  /** Whether this subscription is currently active */
  enabled: boolean;
  /** The handler function for this event */
  handler: EventHandler;
  /** Filter conditions (optional, narrows which events are delivered) */
  filter: Record<string, unknown> | null;
  /** Registration timestamp */
  registeredAt: Date;
}

/**
 * Event payload delivered to subscribers.
 */
export interface DomainEventPayload {
  /** Event type */
  eventType: ApprovedEvent;
  /** Tenant ID */
  tenantId: string;
  /** Entity ID that triggered the event */
  entityId: string;
  /** Entity type */
  entityType: string;
  /** Actor who caused the event */
  actorId: string;
  /** Event timestamp */
  timestamp: Date;
  /** Event-specific data */
  data: Record<string, unknown>;
  /** Correlation ID for tracing */
  correlationId: string;
}

/**
 * Event handler function type.
 */
export type EventHandler = (event: DomainEventPayload, context: HookContext) => Promise<void>;
