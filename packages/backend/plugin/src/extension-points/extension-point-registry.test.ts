/**
 * Extension Point Registry Tests
 *
 * Tests for the Extension Point Framework covering:
 * - Hook registration and invocation
 * - UI slot registration
 * - Event subscription and dispatch
 * - Permission validation
 * - Stability rating enforcement
 * - Timeout handling
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ExtensionPointRegistry } from './extension-point-registry.js';
import {
  BUILT_IN_EXTENSION_POINTS,
  BUILT_IN_UI_SLOTS,
  BUILT_IN_EVENT_DEFINITIONS,
} from './built-in-definitions.js';
import type {
  ExtensionPointDefinition,
  HookHandler,
  UISlotDefinition,
  EventSubscriptionDefinition,
  DomainEventPayload,
} from './types.js';

describe('ExtensionPointRegistry', () => {
  let registry: ExtensionPointRegistry;

  beforeEach(() => {
    registry = new ExtensionPointRegistry();
  });

  // ─── Extension Point Registration ──────────────────────────────────────────

  describe('registerExtensionPoint', () => {
    it('should register a new extension point', () => {
      const ep: ExtensionPointDefinition = {
        id: 'test.before-create',
        name: 'Test Before Create',
        description: 'Test hook',
        hookType: 'before-create',
        entityType: 'test',
        version: '1.0.0',
        stability: 'stable',
        requiredPermissions: ['test.write'],
        payloadSchema: { type: 'object' },
        returnSchema: null,
        mutable: true,
        synchronous: true,
        timeoutMs: 5000,
        introducedIn: '1.0.0',
        deprecatedIn: null,
        replacedBy: null,
      };

      registry.registerExtensionPoint(ep);
      expect(registry.getExtensionPoint('test.before-create')).toEqual(ep);
    });

    it('should reject duplicate extension point IDs', () => {
      const ep: ExtensionPointDefinition = {
        id: 'test.before-create',
        name: 'Test',
        description: 'Test',
        hookType: 'before-create',
        entityType: 'test',
        version: '1.0.0',
        stability: 'stable',
        requiredPermissions: [],
        payloadSchema: {},
        returnSchema: null,
        mutable: false,
        synchronous: true,
        timeoutMs: 5000,
        introducedIn: '1.0.0',
        deprecatedIn: null,
        replacedBy: null,
      };

      registry.registerExtensionPoint(ep);
      expect(() => registry.registerExtensionPoint(ep)).toThrow(
        "Extension point 'test.before-create' is already registered",
      );
    });

    it('should list extension points with filters', () => {
      BUILT_IN_EXTENSION_POINTS.forEach((ep) =>
        registry.registerExtensionPoint(ep),
      );

      const studentHooks = registry.listExtensionPoints({
        entityType: 'student',
      });
      expect(studentHooks.length).toBeGreaterThan(0);
      expect(studentHooks.every((ep) => ep.entityType === 'student')).toBe(true);

      const validationHooks = registry.listExtensionPoints({
        hookType: 'validation',
      });
      expect(validationHooks.length).toBeGreaterThan(0);
      expect(validationHooks.every((ep) => ep.hookType === 'validation')).toBe(true);
    });
  });

  // ─── Hook Registration and Invocation ──────────────────────────────────────

  describe('registerHook', () => {
    const testEp: ExtensionPointDefinition = {
      id: 'test.before-create',
      name: 'Test Before Create',
      description: 'Test hook',
      hookType: 'before-create',
      entityType: 'test',
      version: '1.0.0',
      stability: 'stable',
      requiredPermissions: ['test.write'],
      payloadSchema: { type: 'object' },
      returnSchema: { type: 'object' },
      mutable: true,
      synchronous: true,
      timeoutMs: 5000,
      introducedIn: '1.0.0',
      deprecatedIn: null,
      replacedBy: null,
    };

    beforeEach(() => {
      registry.registerExtensionPoint(testEp);
    });

    it('should register a hook handler', () => {
      const handler: HookHandler = async () => ({
        success: true,
        executionTimeMs: 0,
      });

      const registration = registry.registerHook({
        extensionPointId: 'test.before-create',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        handler,
        pluginPermissions: ['test.write'],
      });

      expect(registration.id).toBeDefined();
      expect(registration.extensionPointId).toBe('test.before-create');
      expect(registration.enabled).toBe(true);
    });

    it('should reject hooks for non-existent extension points', () => {
      const handler: HookHandler = async () => ({
        success: true,
        executionTimeMs: 0,
      });

      expect(() =>
        registry.registerHook({
          extensionPointId: 'non-existent',
          pluginId: 'plugin-1',
          pluginInstallId: 'install-1',
          tenantId: 'tenant-1',
          handler,
          pluginPermissions: [],
        }),
      ).toThrow('Extension point not found: non-existent');
    });

    it('should reject hooks when plugin lacks required permissions', () => {
      const handler: HookHandler = async () => ({
        success: true,
        executionTimeMs: 0,
      });

      expect(() =>
        registry.registerHook({
          extensionPointId: 'test.before-create',
          pluginId: 'plugin-1',
          pluginInstallId: 'install-1',
          tenantId: 'tenant-1',
          handler,
          pluginPermissions: ['other.permission'],
        }),
      ).toThrow("Plugin lacks required permissions for extension point 'test.before-create': test.write");
    });

    it('should reject hooks for deprecated extension points', () => {
      const deprecatedEp: ExtensionPointDefinition = {
        id: 'test.deprecated',
        name: 'Deprecated Hook',
        description: 'Old hook',
        hookType: 'before-create',
        entityType: 'test',
        version: '1.0.0',
        stability: 'deprecated',
        requiredPermissions: [],
        payloadSchema: {},
        returnSchema: null,
        mutable: false,
        synchronous: true,
        timeoutMs: 5000,
        introducedIn: '0.5.0',
        deprecatedIn: '1.0.0',
        replacedBy: 'test.before-create',
      };
      registry.registerExtensionPoint(deprecatedEp);

      const handler: HookHandler = async () => ({
        success: true,
        executionTimeMs: 0,
      });

      expect(() =>
        registry.registerHook({
          extensionPointId: 'test.deprecated',
          pluginId: 'plugin-1',
          pluginInstallId: 'install-1',
          tenantId: 'tenant-1',
          handler,
          pluginPermissions: [],
        }),
      ).toThrow("Extension point 'test.deprecated' is deprecated. Use 'test.before-create' instead");
    });
  });

  describe('invokeHooks', () => {
    const testEp: ExtensionPointDefinition = {
      id: 'test.before-create',
      name: 'Test Before Create',
      description: 'Test hook',
      hookType: 'before-create',
      entityType: 'test',
      version: '1.0.0',
      stability: 'stable',
      requiredPermissions: ['test.write'],
      payloadSchema: { type: 'object' },
      returnSchema: { type: 'object' },
      mutable: true,
      synchronous: true,
      timeoutMs: 100,
      introducedIn: '1.0.0',
      deprecatedIn: null,
      replacedBy: null,
    };

    beforeEach(() => {
      registry.registerExtensionPoint(testEp);
    });

    it('should invoke hooks in priority order', async () => {
      const order: number[] = [];

      registry.registerHook({
        extensionPointId: 'test.before-create',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        handler: async () => {
          order.push(2);
          return { success: true, executionTimeMs: 0 };
        },
        priority: 200,
        pluginPermissions: ['test.write'],
      });

      registry.registerHook({
        extensionPointId: 'test.before-create',
        pluginId: 'plugin-2',
        pluginInstallId: 'install-2',
        tenantId: 'tenant-1',
        handler: async () => {
          order.push(1);
          return { success: true, executionTimeMs: 0 };
        },
        priority: 50,
        pluginPermissions: ['test.write'],
      });

      await registry.invokeHooks('test.before-create', { name: 'test' }, {
        tenantId: 'tenant-1',
        actorId: 'user-1',
      });

      expect(order).toEqual([1, 2]);
    });

    it('should only invoke hooks for the matching tenant', async () => {
      let invoked = false;

      registry.registerHook({
        extensionPointId: 'test.before-create',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-2',
        handler: async () => {
          invoked = true;
          return { success: true, executionTimeMs: 0 };
        },
        pluginPermissions: ['test.write'],
      });

      await registry.invokeHooks('test.before-create', {}, {
        tenantId: 'tenant-1',
        actorId: 'user-1',
      });

      expect(invoked).toBe(false);
    });

    it('should handle hook timeout', async () => {
      registry.registerHook({
        extensionPointId: 'test.before-create',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { success: true, executionTimeMs: 0 };
        },
        pluginPermissions: ['test.write'],
      });

      const results = await registry.invokeHooks('test.before-create', {}, {
        tenantId: 'tenant-1',
        actorId: 'user-1',
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(false);
      expect(results[0]!.errors![0]!.code).toBe('HOOK_EXECUTION_ERROR');
    });

    it('should stop execution when a synchronous hook aborts', async () => {
      const order: number[] = [];

      registry.registerHook({
        extensionPointId: 'test.before-create',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        handler: async () => {
          order.push(1);
          return { success: true, abort: true, abortReason: 'Blocked', executionTimeMs: 0 };
        },
        priority: 10,
        pluginPermissions: ['test.write'],
      });

      registry.registerHook({
        extensionPointId: 'test.before-create',
        pluginId: 'plugin-2',
        pluginInstallId: 'install-2',
        tenantId: 'tenant-1',
        handler: async () => {
          order.push(2);
          return { success: true, executionTimeMs: 0 };
        },
        priority: 20,
        pluginPermissions: ['test.write'],
      });

      const results = await registry.invokeHooks('test.before-create', {}, {
        tenantId: 'tenant-1',
        actorId: 'user-1',
      });

      expect(order).toEqual([1]);
      expect(results).toHaveLength(1);
      expect(results[0]!.abort).toBe(true);
    });
  });

  // ─── UI Slot Management ────────────────────────────────────────────────────

  describe('UI Slots', () => {
    const testSlot: UISlotDefinition = {
      id: 'test.sidebar',
      name: 'Test Sidebar',
      description: 'Test sidebar slot',
      location: 'entity-detail-sidebar',
      entityType: 'test',
      version: '1.0.0',
      stability: 'stable',
      requiredPermissions: ['test.read'],
      maxRegistrations: 3,
      propsSchema: { type: 'object' },
    };

    beforeEach(() => {
      registry.registerUISlot(testSlot);
    });

    it('should register a UI slot', () => {
      expect(registry.getUISlot('test.sidebar')).toEqual(testSlot);
    });

    it('should reject duplicate UI slot IDs', () => {
      expect(() => registry.registerUISlot(testSlot)).toThrow(
        "UI slot 'test.sidebar' is already registered",
      );
    });

    it('should register a component in a UI slot', () => {
      const registration = registry.registerUISlotComponent({
        slotId: 'test.sidebar',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        componentId: 'my-widget',
        label: 'My Widget',
        icon: 'chart',
        pluginPermissions: ['test.read'],
      });

      expect(registration.id).toBeDefined();
      expect(registration.componentId).toBe('my-widget');
      expect(registration.label).toBe('My Widget');
    });

    it('should reject component registration without permissions', () => {
      expect(() =>
        registry.registerUISlotComponent({
          slotId: 'test.sidebar',
          pluginId: 'plugin-1',
          pluginInstallId: 'install-1',
          tenantId: 'tenant-1',
          componentId: 'my-widget',
          label: 'My Widget',
          pluginPermissions: [],
        }),
      ).toThrow("Plugin lacks required permissions for UI slot 'test.sidebar': test.read");
    });

    it('should enforce max registrations per slot', () => {
      for (let i = 0; i < 3; i++) {
        registry.registerUISlotComponent({
          slotId: 'test.sidebar',
          pluginId: `plugin-${i}`,
          pluginInstallId: `install-${i}`,
          tenantId: 'tenant-1',
          componentId: `widget-${i}`,
          label: `Widget ${i}`,
          pluginPermissions: ['test.read'],
        });
      }

      expect(() =>
        registry.registerUISlotComponent({
          slotId: 'test.sidebar',
          pluginId: 'plugin-4',
          pluginInstallId: 'install-4',
          tenantId: 'tenant-1',
          componentId: 'widget-4',
          label: 'Widget 4',
          pluginPermissions: ['test.read'],
        }),
      ).toThrow("UI slot 'test.sidebar' has reached maximum registrations (3)");
    });

    it('should return registrations ordered by order field', () => {
      registry.registerUISlotComponent({
        slotId: 'test.sidebar',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        componentId: 'widget-b',
        label: 'Widget B',
        order: 200,
        pluginPermissions: ['test.read'],
      });

      registry.registerUISlotComponent({
        slotId: 'test.sidebar',
        pluginId: 'plugin-2',
        pluginInstallId: 'install-2',
        tenantId: 'tenant-1',
        componentId: 'widget-a',
        label: 'Widget A',
        order: 50,
        pluginPermissions: ['test.read'],
      });

      const registrations = registry.getUISlotRegistrations('test.sidebar', 'tenant-1');
      expect(registrations[0]!.componentId).toBe('widget-a');
      expect(registrations[1]!.componentId).toBe('widget-b');
    });

    it('should list UI slots with filters', () => {
      BUILT_IN_UI_SLOTS.forEach((slot) => registry.registerUISlot(slot));

      const tabSlots = registry.listUISlots({ location: 'entity-detail-tab' });
      expect(tabSlots.length).toBeGreaterThan(0);
      expect(tabSlots.every((s) => s.location === 'entity-detail-tab')).toBe(true);
    });
  });

  // ─── Event Subscription ────────────────────────────────────────────────────

  describe('Event Subscriptions', () => {
    const testEventDef: EventSubscriptionDefinition = {
      eventType: 'student.created',
      name: 'Student Created',
      description: 'Fired when a student is created',
      version: '1.0.0',
      stability: 'stable',
      requiredPermissions: ['student.read'],
      payloadSchema: { type: 'object' },
      entityType: 'student',
    };

    beforeEach(() => {
      registry.registerEventDefinition(testEventDef);
    });

    it('should register an event definition', () => {
      expect(registry.getEventDefinition('student.created')).toEqual(testEventDef);
    });

    it('should subscribe to an approved event', () => {
      const subscription = registry.subscribeToEvent({
        eventType: 'student.created',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        handler: async () => {},
        pluginPermissions: ['student.read'],
      });

      expect(subscription.id).toBeDefined();
      expect(subscription.eventType).toBe('student.created');
      expect(subscription.enabled).toBe(true);
    });

    it('should reject subscription to unapproved events', () => {
      expect(() =>
        registry.subscribeToEvent({
          eventType: 'student.deleted' as any,
          pluginId: 'plugin-1',
          pluginInstallId: 'install-1',
          tenantId: 'tenant-1',
          handler: async () => {},
          pluginPermissions: [],
        }),
      ).toThrow("Event 'student.deleted' is not an approved event");
    });

    it('should reject subscription without required permissions', () => {
      expect(() =>
        registry.subscribeToEvent({
          eventType: 'student.created',
          pluginId: 'plugin-1',
          pluginInstallId: 'install-1',
          tenantId: 'tenant-1',
          handler: async () => {},
          pluginPermissions: ['other.permission'],
        }),
      ).toThrow("Plugin lacks required permissions for event 'student.created': student.read");
    });

    it('should dispatch events to subscribed handlers', async () => {
      let receivedEvent: DomainEventPayload | null = null;

      registry.subscribeToEvent({
        eventType: 'student.created',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        handler: async (event) => {
          receivedEvent = event;
        },
        pluginPermissions: ['student.read'],
      });

      const event: DomainEventPayload = {
        eventType: 'student.created',
        tenantId: 'tenant-1',
        entityId: 'student-123',
        entityType: 'student',
        actorId: 'user-1',
        timestamp: new Date(),
        data: { name: 'John Doe' },
        correlationId: 'corr-1',
      };

      await registry.dispatchEvent(event);

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent!.entityId).toBe('student-123');
    });

    it('should only dispatch events to matching tenant', async () => {
      let invoked = false;

      registry.subscribeToEvent({
        eventType: 'student.created',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-2',
        handler: async () => {
          invoked = true;
        },
        pluginPermissions: ['student.read'],
      });

      await registry.dispatchEvent({
        eventType: 'student.created',
        tenantId: 'tenant-1',
        entityId: 'student-123',
        entityType: 'student',
        actorId: 'user-1',
        timestamp: new Date(),
        data: {},
        correlationId: 'corr-1',
      });

      expect(invoked).toBe(false);
    });

    it('should apply event filters', async () => {
      let invoked = false;

      registry.subscribeToEvent({
        eventType: 'student.created',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        handler: async () => {
          invoked = true;
        },
        filter: { institutionId: 'inst-abc' },
        pluginPermissions: ['student.read'],
      });

      // Event with non-matching filter
      await registry.dispatchEvent({
        eventType: 'student.created',
        tenantId: 'tenant-1',
        entityId: 'student-123',
        entityType: 'student',
        actorId: 'user-1',
        timestamp: new Date(),
        data: { institutionId: 'inst-xyz' },
        correlationId: 'corr-1',
      });

      expect(invoked).toBe(false);

      // Event with matching filter
      await registry.dispatchEvent({
        eventType: 'student.created',
        tenantId: 'tenant-1',
        entityId: 'student-456',
        entityType: 'student',
        actorId: 'user-1',
        timestamp: new Date(),
        data: { institutionId: 'inst-abc' },
        correlationId: 'corr-2',
      });

      expect(invoked).toBe(true);
    });
  });

  // ─── Cleanup and Unregistration ────────────────────────────────────────────

  describe('unregisterAllForInstall', () => {
    it('should remove all registrations for a plugin installation', () => {
      const ep: ExtensionPointDefinition = {
        id: 'test.hook',
        name: 'Test',
        description: 'Test',
        hookType: 'before-create',
        entityType: 'test',
        version: '1.0.0',
        stability: 'stable',
        requiredPermissions: [],
        payloadSchema: {},
        returnSchema: null,
        mutable: false,
        synchronous: true,
        timeoutMs: 5000,
        introducedIn: '1.0.0',
        deprecatedIn: null,
        replacedBy: null,
      };
      registry.registerExtensionPoint(ep);

      const slot: UISlotDefinition = {
        id: 'test.slot',
        name: 'Test Slot',
        description: 'Test',
        location: 'dashboard-widget',
        entityType: 'test',
        version: '1.0.0',
        stability: 'stable',
        requiredPermissions: [],
        maxRegistrations: 10,
        propsSchema: {},
      };
      registry.registerUISlot(slot);

      const eventDef: EventSubscriptionDefinition = {
        eventType: 'student.created',
        name: 'Student Created',
        description: 'Test',
        version: '1.0.0',
        stability: 'stable',
        requiredPermissions: [],
        payloadSchema: {},
        entityType: 'student',
      };
      registry.registerEventDefinition(eventDef);

      // Register hook, UI slot component, and event subscription
      registry.registerHook({
        extensionPointId: 'test.hook',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        handler: async () => ({ success: true, executionTimeMs: 0 }),
        pluginPermissions: [],
      });

      registry.registerUISlotComponent({
        slotId: 'test.slot',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        componentId: 'widget-1',
        label: 'Widget',
        pluginPermissions: [],
      });

      registry.subscribeToEvent({
        eventType: 'student.created',
        pluginId: 'plugin-1',
        pluginInstallId: 'install-1',
        tenantId: 'tenant-1',
        handler: async () => {},
        pluginPermissions: [],
      });

      // Verify registrations exist
      expect(registry.getHookRegistrations('test.hook')).toHaveLength(1);
      expect(registry.getUISlotRegistrations('test.slot', 'tenant-1')).toHaveLength(1);
      expect(registry.getEventSubscriptions('student.created')).toHaveLength(1);

      // Unregister all for install
      const count = registry.unregisterAllForInstall('install-1');
      expect(count).toBe(3);

      // Verify all removed
      expect(registry.getHookRegistrations('test.hook')).toHaveLength(0);
      expect(registry.getUISlotRegistrations('test.slot', 'tenant-1')).toHaveLength(0);
      expect(registry.getEventSubscriptions('student.created')).toHaveLength(0);
    });
  });

  // ─── Built-in Definitions ──────────────────────────────────────────────────

  describe('Built-in Definitions', () => {
    it('should register all built-in extension points without error', () => {
      BUILT_IN_EXTENSION_POINTS.forEach((ep) => {
        registry.registerExtensionPoint(ep);
      });

      expect(registry.listExtensionPoints()).toHaveLength(
        BUILT_IN_EXTENSION_POINTS.length,
      );
    });

    it('should register all built-in UI slots without error', () => {
      BUILT_IN_UI_SLOTS.forEach((slot) => {
        registry.registerUISlot(slot);
      });

      expect(registry.listUISlots()).toHaveLength(BUILT_IN_UI_SLOTS.length);
    });

    it('should register all built-in event definitions without error', () => {
      BUILT_IN_EVENT_DEFINITIONS.forEach((def) => {
        registry.registerEventDefinition(def);
      });

      expect(registry.listEventDefinitions()).toHaveLength(
        BUILT_IN_EVENT_DEFINITIONS.length,
      );
    });

    it('should provide a summary of all registrations', () => {
      BUILT_IN_EXTENSION_POINTS.forEach((ep) =>
        registry.registerExtensionPoint(ep),
      );
      BUILT_IN_UI_SLOTS.forEach((slot) => registry.registerUISlot(slot));
      BUILT_IN_EVENT_DEFINITIONS.forEach((def) =>
        registry.registerEventDefinition(def),
      );

      const summary = registry.getSummary();
      expect(summary.extensionPoints).toBe(BUILT_IN_EXTENSION_POINTS.length);
      expect(summary.uiSlots).toBe(BUILT_IN_UI_SLOTS.length);
      expect(summary.eventDefinitions).toBe(BUILT_IN_EVENT_DEFINITIONS.length);
      expect(summary.totalHookRegistrations).toBe(0);
      expect(summary.totalUISlotRegistrations).toBe(0);
      expect(summary.totalEventSubscriptions).toBe(0);
    });
  });
});
