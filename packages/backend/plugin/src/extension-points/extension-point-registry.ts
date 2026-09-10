/**
 * Extension Point Registry
 *
 * Central registry for all extension points in the platform.
 * Manages registration, discovery, and validation of extension points.
 *
 * Extension points are versioned and rated for stability:
 * - stable: Backward-compatible within major version
 * - beta: May change in minor versions
 * - experimental: May change without notice
 * - deprecated: Scheduled for removal
 */
import { v4 as uuidv4 } from 'uuid';
import { BusinessRuleError, NotFoundError } from '@proctira/common';

import type {
  ExtensionPointDefinition,
  HookType,
  HookRegistration,
  HookHandler,
  HookContext,
  HookResult,
  UISlotDefinition,
  UISlotRegistration,
  EventSubscriptionDefinition,
  EventSubscription,
  EventHandler,
  DomainEventPayload,
  ApprovedEvent,
  StabilityRating,
} from './types.js';

/**
 * Options for invoking hooks on an extension point.
 */
export interface InvokeHooksOptions {
  /** Tenant ID */
  tenantId: string;
  /** Actor ID */
  actorId: string;
  /** Correlation ID for tracing */
  correlationId?: string;
}

/**
 * Extension Point Registry - manages all extension points, hooks, UI slots, and event subscriptions.
 */
export class ExtensionPointRegistry {
  /** All registered extension point definitions */
  private extensionPoints: Map<string, ExtensionPointDefinition> = new Map();

  /** Hook registrations indexed by extension point ID */
  private hookRegistrations: Map<string, HookRegistration[]> = new Map();

  /** UI slot definitions */
  private uiSlots: Map<string, UISlotDefinition> = new Map();

  /** UI slot registrations indexed by slot ID */
  private uiSlotRegistrations: Map<string, UISlotRegistration[]> = new Map();

  /** Event subscription definitions */
  private eventDefinitions: Map<string, EventSubscriptionDefinition> = new Map();

  /** Event subscriptions indexed by event type */
  private eventSubscriptions: Map<string, EventSubscription[]> = new Map();

  // ─── Extension Point Management ────────────────────────────────────────────

  /**
   * Register a new extension point definition.
   * Called by platform services to declare their extension points.
   */
  registerExtensionPoint(definition: ExtensionPointDefinition): void {
    if (this.extensionPoints.has(definition.id)) {
      throw new BusinessRuleError(`Extension point '${definition.id}' is already registered`);
    }
    this.extensionPoints.set(definition.id, definition);
    this.hookRegistrations.set(definition.id, []);
  }

  /**
   * Get an extension point definition by ID.
   */
  getExtensionPoint(id: string): ExtensionPointDefinition | null {
    return this.extensionPoints.get(id) ?? null;
  }

  /**
   * List all registered extension points, optionally filtered.
   */
  listExtensionPoints(filter?: {
    hookType?: HookType;
    entityType?: string;
    stability?: StabilityRating;
  }): ExtensionPointDefinition[] {
    let results = Array.from(this.extensionPoints.values());

    if (filter?.hookType) {
      results = results.filter((ep) => ep.hookType === filter.hookType);
    }
    if (filter?.entityType) {
      results = results.filter((ep) => ep.entityType === filter.entityType);
    }
    if (filter?.stability) {
      results = results.filter((ep) => ep.stability === filter.stability);
    }

    return results;
  }

  // ─── Hook Registration ─────────────────────────────────────────────────────

  /**
   * Register a hook handler for an extension point.
   * Validates that the extension point exists, is not deprecated,
   * and that the plugin has the required permissions.
   */
  registerHook(params: {
    extensionPointId: string;
    pluginId: string;
    pluginInstallId: string;
    tenantId: string;
    handler: HookHandler;
    priority?: number;
    pluginPermissions: string[];
  }): HookRegistration {
    const {
      extensionPointId,
      pluginId,
      pluginInstallId,
      tenantId,
      handler,
      priority = 100,
      pluginPermissions,
    } = params;

    // Validate extension point exists
    const extensionPoint = this.extensionPoints.get(extensionPointId);
    if (!extensionPoint) {
      throw new NotFoundError(`Extension point not found: ${extensionPointId}`);
    }

    // Reject deprecated extension points
    if (extensionPoint.stability === 'deprecated') {
      throw new BusinessRuleError(
        `Extension point '${extensionPointId}' is deprecated` +
          (extensionPoint.replacedBy ? `. Use '${extensionPoint.replacedBy}' instead` : ''),
      );
    }

    // Validate permissions
    const missingPermissions = extensionPoint.requiredPermissions.filter(
      (p) => !pluginPermissions.includes(p),
    );
    if (missingPermissions.length > 0) {
      throw new BusinessRuleError(
        `Plugin lacks required permissions for extension point '${extensionPointId}': ${missingPermissions.join(', ')}`,
      );
    }

    const registration: HookRegistration = {
      id: uuidv4(),
      extensionPointId,
      pluginId,
      pluginInstallId,
      tenantId,
      priority,
      enabled: true,
      handler,
      registeredAt: new Date(),
    };

    const registrations = this.hookRegistrations.get(extensionPointId) ?? [];
    registrations.push(registration);
    // Sort by priority (lower = earlier)
    registrations.sort((a, b) => a.priority - b.priority);
    this.hookRegistrations.set(extensionPointId, registrations);

    return registration;
  }

  /**
   * Unregister a hook by registration ID.
   */
  unregisterHook(registrationId: string): boolean {
    for (const [epId, registrations] of this.hookRegistrations.entries()) {
      const index = registrations.findIndex((r) => r.id === registrationId);
      if (index !== -1) {
        registrations.splice(index, 1);
        this.hookRegistrations.set(epId, registrations);
        return true;
      }
    }
    return false;
  }

  /**
   * Unregister all hooks for a specific plugin installation.
   * Called when a plugin is uninstalled or disabled.
   */
  unregisterAllForInstall(pluginInstallId: string): number {
    let count = 0;
    for (const [epId, registrations] of this.hookRegistrations.entries()) {
      const filtered = registrations.filter((r) => r.pluginInstallId !== pluginInstallId);
      count += registrations.length - filtered.length;
      this.hookRegistrations.set(epId, filtered);
    }

    // Also remove UI slot registrations
    for (const [slotId, registrations] of this.uiSlotRegistrations.entries()) {
      const filtered = registrations.filter((r) => r.pluginInstallId !== pluginInstallId);
      count += registrations.length - filtered.length;
      this.uiSlotRegistrations.set(slotId, filtered);
    }

    // Also remove event subscriptions
    for (const [eventType, subscriptions] of this.eventSubscriptions.entries()) {
      const filtered = subscriptions.filter((s) => s.pluginInstallId !== pluginInstallId);
      count += subscriptions.length - filtered.length;
      this.eventSubscriptions.set(eventType, filtered);
    }

    return count;
  }

  /**
   * Invoke all registered hooks for an extension point.
   * Executes handlers in priority order with timeout enforcement.
   */
  async invokeHooks<TPayload = unknown, TResult = unknown>(
    extensionPointId: string,
    payload: TPayload,
    options: InvokeHooksOptions,
  ): Promise<HookResult<TResult>[]> {
    const extensionPoint = this.extensionPoints.get(extensionPointId);
    if (!extensionPoint) {
      return [];
    }

    const registrations = (this.hookRegistrations.get(extensionPointId) ?? []).filter(
      (r) => r.enabled && r.tenantId === options.tenantId,
    );

    if (registrations.length === 0) {
      return [];
    }

    const results: HookResult<TResult>[] = [];

    for (const registration of registrations) {
      const context: HookContext = {
        tenantId: options.tenantId,
        actorId: options.actorId,
        extensionPointId,
        pluginInstallId: registration.pluginInstallId,
        correlationId: options.correlationId ?? uuidv4(),
        timestamp: new Date(),
      };

      const startTime = Date.now();

      try {
        const result = await Promise.race([
          registration.handler(payload, context) as Promise<HookResult<TResult>>,
          new Promise<HookResult<TResult>>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Hook timeout after ${extensionPoint.timeoutMs}ms`)),
              extensionPoint.timeoutMs,
            ),
          ),
        ]);

        result.executionTimeMs = Date.now() - startTime;
        results.push(result);

        // For synchronous hooks, abort if requested
        if (extensionPoint.synchronous && result.abort) {
          break;
        }
      } catch (error: unknown) {
        const executionTimeMs = Date.now() - startTime;
        results.push({
          success: false,
          errors: [
            {
              field: '_hook',
              message: error instanceof Error ? error.message : 'Unknown hook error',
              code: 'HOOK_EXECUTION_ERROR',
            },
          ],
          executionTimeMs,
        });
      }
    }

    return results;
  }

  /**
   * Get all hook registrations for an extension point.
   */
  getHookRegistrations(extensionPointId: string, tenantId?: string): HookRegistration[] {
    const registrations = this.hookRegistrations.get(extensionPointId) ?? [];
    if (tenantId) {
      return registrations.filter((r) => r.tenantId === tenantId);
    }
    return registrations;
  }

  // ─── UI Slot Management ────────────────────────────────────────────────────

  /**
   * Register a UI slot definition.
   * Called by the platform to declare available UI extension slots.
   */
  registerUISlot(definition: UISlotDefinition): void {
    if (this.uiSlots.has(definition.id)) {
      throw new BusinessRuleError(`UI slot '${definition.id}' is already registered`);
    }
    this.uiSlots.set(definition.id, definition);
    this.uiSlotRegistrations.set(definition.id, []);
  }

  /**
   * Get a UI slot definition by ID.
   */
  getUISlot(id: string): UISlotDefinition | null {
    return this.uiSlots.get(id) ?? null;
  }

  /**
   * List all registered UI slots.
   */
  listUISlots(filter?: {
    location?: string;
    entityType?: string;
    stability?: StabilityRating;
  }): UISlotDefinition[] {
    let results = Array.from(this.uiSlots.values());

    if (filter?.location) {
      results = results.filter((s) => s.location === filter.location);
    }
    if (filter?.entityType) {
      results = results.filter((s) => s.entityType === filter.entityType);
    }
    if (filter?.stability) {
      results = results.filter((s) => s.stability === filter.stability);
    }

    return results;
  }

  /**
   * Register a plugin component in a UI slot.
   */
  registerUISlotComponent(params: {
    slotId: string;
    pluginId: string;
    pluginInstallId: string;
    tenantId: string;
    componentId: string;
    label: string;
    icon?: string;
    order?: number;
    pluginPermissions: string[];
  }): UISlotRegistration {
    const {
      slotId,
      pluginId,
      pluginInstallId,
      tenantId,
      componentId,
      label,
      icon,
      order = 100,
      pluginPermissions,
    } = params;

    // Validate slot exists
    const slot = this.uiSlots.get(slotId);
    if (!slot) {
      throw new NotFoundError(`UI slot not found: ${slotId}`);
    }

    // Validate permissions
    const missingPermissions = slot.requiredPermissions.filter(
      (p) => !pluginPermissions.includes(p),
    );
    if (missingPermissions.length > 0) {
      throw new BusinessRuleError(
        `Plugin lacks required permissions for UI slot '${slotId}': ${missingPermissions.join(', ')}`,
      );
    }

    // Check max registrations
    const existing = (this.uiSlotRegistrations.get(slotId) ?? []).filter(
      (r) => r.tenantId === tenantId && r.enabled,
    );
    if (existing.length >= slot.maxRegistrations) {
      throw new BusinessRuleError(
        `UI slot '${slotId}' has reached maximum registrations (${slot.maxRegistrations})`,
      );
    }

    const registration: UISlotRegistration = {
      id: uuidv4(),
      slotId,
      pluginId,
      pluginInstallId,
      tenantId,
      order,
      enabled: true,
      componentId,
      label,
      icon: icon ?? null,
      registeredAt: new Date(),
    };

    const registrations = this.uiSlotRegistrations.get(slotId) ?? [];
    registrations.push(registration);
    registrations.sort((a, b) => a.order - b.order);
    this.uiSlotRegistrations.set(slotId, registrations);

    return registration;
  }

  /**
   * Get all component registrations for a UI slot.
   */
  getUISlotRegistrations(slotId: string, tenantId: string): UISlotRegistration[] {
    return (this.uiSlotRegistrations.get(slotId) ?? []).filter(
      (r) => r.tenantId === tenantId && r.enabled,
    );
  }

  // ─── Event Subscription Management ────────────────────────────────────────

  /**
   * Register an event subscription definition.
   * Called by the platform to declare approved events.
   */
  registerEventDefinition(definition: EventSubscriptionDefinition): void {
    if (this.eventDefinitions.has(definition.eventType)) {
      throw new BusinessRuleError(
        `Event definition '${definition.eventType}' is already registered`,
      );
    }
    this.eventDefinitions.set(definition.eventType, definition);
    this.eventSubscriptions.set(definition.eventType, []);
  }

  /**
   * Get an event subscription definition.
   */
  getEventDefinition(eventType: ApprovedEvent): EventSubscriptionDefinition | null {
    return this.eventDefinitions.get(eventType) ?? null;
  }

  /**
   * List all approved event definitions.
   */
  listEventDefinitions(filter?: {
    entityType?: string;
    stability?: StabilityRating;
  }): EventSubscriptionDefinition[] {
    let results = Array.from(this.eventDefinitions.values());

    if (filter?.entityType) {
      results = results.filter((e) => e.entityType === filter.entityType);
    }
    if (filter?.stability) {
      results = results.filter((e) => e.stability === filter.stability);
    }

    return results;
  }

  /**
   * Subscribe a plugin to an approved event.
   * Only events that have been explicitly registered as approved can be subscribed to.
   */
  subscribeToEvent(params: {
    eventType: ApprovedEvent;
    pluginId: string;
    pluginInstallId: string;
    tenantId: string;
    handler: EventHandler;
    filter?: Record<string, unknown>;
    pluginPermissions: string[];
  }): EventSubscription {
    const { eventType, pluginId, pluginInstallId, tenantId, handler, filter, pluginPermissions } =
      params;

    // Validate event is approved
    const eventDef = this.eventDefinitions.get(eventType);
    if (!eventDef) {
      throw new BusinessRuleError(
        `Event '${eventType}' is not an approved event. Only approved events can be subscribed to.`,
      );
    }

    // Validate permissions
    const missingPermissions = eventDef.requiredPermissions.filter(
      (p) => !pluginPermissions.includes(p),
    );
    if (missingPermissions.length > 0) {
      throw new BusinessRuleError(
        `Plugin lacks required permissions for event '${eventType}': ${missingPermissions.join(', ')}`,
      );
    }

    const subscription: EventSubscription = {
      id: uuidv4(),
      eventType,
      pluginId,
      pluginInstallId,
      tenantId,
      enabled: true,
      handler,
      filter: filter ?? null,
      registeredAt: new Date(),
    };

    const subscriptions = this.eventSubscriptions.get(eventType) ?? [];
    subscriptions.push(subscription);
    this.eventSubscriptions.set(eventType, subscriptions);

    return subscription;
  }

  /**
   * Unsubscribe from an event by subscription ID.
   */
  unsubscribeFromEvent(subscriptionId: string): boolean {
    for (const [eventType, subscriptions] of this.eventSubscriptions.entries()) {
      const index = subscriptions.findIndex((s) => s.id === subscriptionId);
      if (index !== -1) {
        subscriptions.splice(index, 1);
        this.eventSubscriptions.set(eventType, subscriptions);
        return true;
      }
    }
    return false;
  }

  /**
   * Dispatch a domain event to all subscribed plugins for the given tenant.
   * Only delivers to enabled subscriptions matching the tenant.
   */
  async dispatchEvent(event: DomainEventPayload): Promise<void> {
    const subscriptions = (this.eventSubscriptions.get(event.eventType) ?? []).filter(
      (s) => s.enabled && s.tenantId === event.tenantId,
    );

    if (subscriptions.length === 0) {
      return;
    }

    const promises = subscriptions.map(async (subscription) => {
      // Apply filter if present
      if (subscription.filter) {
        const matches = Object.entries(subscription.filter).every(
          ([key, value]) => event.data[key] === value,
        );
        if (!matches) return;
      }

      const context: HookContext = {
        tenantId: event.tenantId,
        actorId: event.actorId,
        extensionPointId: `event:${event.eventType}`,
        pluginInstallId: subscription.pluginInstallId,
        correlationId: event.correlationId,
        timestamp: event.timestamp,
      };

      try {
        await subscription.handler(event, context);
      } catch {
        // Event handlers are fire-and-forget; errors are logged but don't propagate
        // In production, this would log to the structured logger
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Get all event subscriptions for a specific event type and tenant.
   */
  getEventSubscriptions(eventType: ApprovedEvent, tenantId?: string): EventSubscription[] {
    const subscriptions = this.eventSubscriptions.get(eventType) ?? [];
    if (tenantId) {
      return subscriptions.filter((s) => s.tenantId === tenantId);
    }
    return subscriptions;
  }

  // ─── Utility Methods ───────────────────────────────────────────────────────

  /**
   * Get a summary of all registered extension points, UI slots, and events.
   */
  getSummary(): {
    extensionPoints: number;
    uiSlots: number;
    eventDefinitions: number;
    totalHookRegistrations: number;
    totalUISlotRegistrations: number;
    totalEventSubscriptions: number;
  } {
    let totalHookRegistrations = 0;
    for (const registrations of this.hookRegistrations.values()) {
      totalHookRegistrations += registrations.length;
    }

    let totalUISlotRegistrations = 0;
    for (const registrations of this.uiSlotRegistrations.values()) {
      totalUISlotRegistrations += registrations.length;
    }

    let totalEventSubscriptions = 0;
    for (const subscriptions of this.eventSubscriptions.values()) {
      totalEventSubscriptions += subscriptions.length;
    }

    return {
      extensionPoints: this.extensionPoints.size,
      uiSlots: this.uiSlots.size,
      eventDefinitions: this.eventDefinitions.size,
      totalHookRegistrations,
      totalUISlotRegistrations,
      totalEventSubscriptions,
    };
  }

  /**
   * Clear all registrations (useful for testing).
   */
  clear(): void {
    this.extensionPoints.clear();
    this.hookRegistrations.clear();
    this.uiSlots.clear();
    this.uiSlotRegistrations.clear();
    this.eventDefinitions.clear();
    this.eventSubscriptions.clear();
  }
}
