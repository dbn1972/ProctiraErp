/**
 * Tests for the Plugin Test Harness
 */
import { describe, it, expect } from 'vitest';
import { createTestHarness } from './test-harness.js';
import { definePlugin } from '../core/define-plugin.js';
import { defineHook } from '../core/define-hook.js';
import { defineEventHandler } from '../core/define-event-handler.js';
import type { PluginManifest } from '@proctira/backend-plugin';

const testManifest: PluginManifest = {
  name: 'harness-test-plugin',
  owner: 'test-org',
  version: '1.0.0',
  supportedProductVersions: '>=1.0.0 <2.0.0',
  requiredPermissions: ['student.read', 'notification.send'],
  requiredExtensionPoints: ['student.after-create'],
  tenantScopeBehavior: 'isolated',
  auditBehavior: 'Logs all test operations for validation purposes',
  runtimeDependencies: [],
};

describe('createTestHarness', () => {
  it('should create a harness for a plugin', () => {
    const plugin = definePlugin({ manifest: testManifest });
    const harness = createTestHarness(plugin);

    expect(harness.plugin).toBe(plugin);
  });

  it('should validate the manifest', () => {
    const plugin = definePlugin({ manifest: testManifest });
    const harness = createTestHarness(plugin);

    const result = harness.validateManifest();
    expect(result.valid).toBe(true);
  });

  it('should invoke a registered hook', async () => {
    let receivedPayload: unknown = null;

    const plugin = definePlugin({
      manifest: testManifest,
      hooks: [
        defineHook('student.after-create', async (payload, context) => {
          receivedPayload = payload;
          return { success: true, executionTimeMs: 5 };
        }),
      ],
    });

    const harness = createTestHarness(plugin, { tenantId: 'my-tenant' });
    const result = await harness.invokeHook('student.after-create', { entityId: '123' });

    expect(result.success).toBe(true);
    expect(receivedPayload).toEqual({ entityId: '123' });
  });

  it('should throw when invoking an unregistered hook', async () => {
    const plugin = definePlugin({ manifest: testManifest });
    const harness = createTestHarness(plugin);

    await expect(
      harness.invokeHook('nonexistent.hook', {}),
    ).rejects.toThrow("No hook registered for extension point 'nonexistent.hook'");
  });

  it('should invoke a registered event handler', async () => {
    let receivedEvent: unknown = null;

    const plugin = definePlugin({
      manifest: testManifest,
      eventHandlers: [
        defineEventHandler('student.created', async (event, context) => {
          receivedEvent = event;
        }),
      ],
    });

    const harness = createTestHarness(plugin, { tenantId: 'my-tenant' });
    await harness.invokeEventHandler('student.created', { name: 'John' });

    expect(receivedEvent).toBeDefined();
    expect((receivedEvent as any).eventType).toBe('student.created');
    expect((receivedEvent as any).data).toEqual({ name: 'John' });
  });

  it('should throw when invoking an unregistered event handler', async () => {
    const plugin = definePlugin({ manifest: testManifest });
    const harness = createTestHarness(plugin);

    await expect(
      harness.invokeEventHandler('student.created'),
    ).rejects.toThrow("No event handler registered for event 'student.created'");
  });

  it('should list registered hooks', () => {
    const plugin = definePlugin({
      manifest: testManifest,
      hooks: [
        defineHook('student.after-create', async () => ({ success: true, executionTimeMs: 0 })),
        defineHook('student.before-update', async () => ({ success: true, executionTimeMs: 0 })),
      ],
    });

    const harness = createTestHarness(plugin);
    expect(harness.getRegisteredHooks()).toEqual(['student.after-create', 'student.before-update']);
  });

  it('should list registered events', () => {
    const plugin = definePlugin({
      manifest: testManifest,
      eventHandlers: [
        defineEventHandler('student.created', async () => {}),
        defineEventHandler('attendance.recorded', async () => {}),
      ],
    });

    const harness = createTestHarness(plugin);
    expect(harness.getRegisteredEvents()).toEqual(['student.created', 'attendance.recorded']);
  });

  it('should check required permissions', () => {
    const plugin = definePlugin({ manifest: testManifest });
    const harness = createTestHarness(plugin);

    expect(harness.requiresPermission('student.read')).toBe(true);
    expect(harness.requiresPermission('admin.write')).toBe(false);
  });

  it('should check required extension points', () => {
    const plugin = definePlugin({ manifest: testManifest });
    const harness = createTestHarness(plugin);

    expect(harness.requiresExtensionPoint('student.after-create')).toBe(true);
    expect(harness.requiresExtensionPoint('staff.before-delete')).toBe(false);
  });

  it('should simulate enable lifecycle', async () => {
    let enableCalled = false;

    const plugin = definePlugin({
      manifest: testManifest,
      onEnable: async (context) => {
        enableCalled = true;
        expect(context.tenantId).toBe('test-tenant-001');
      },
    });

    const harness = createTestHarness(plugin);
    await harness.simulateEnable();

    expect(enableCalled).toBe(true);
  });

  it('should simulate disable lifecycle', async () => {
    let disableCalled = false;

    const plugin = definePlugin({
      manifest: testManifest,
      onDisable: async (context) => {
        disableCalled = true;
      },
    });

    const harness = createTestHarness(plugin);
    await harness.simulateDisable();

    expect(disableCalled).toBe(true);
  });
});
