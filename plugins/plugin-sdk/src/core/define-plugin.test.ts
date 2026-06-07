/**
 * Tests for definePlugin
 */
import { describe, it, expect } from 'vitest';
import { definePlugin } from './define-plugin.js';
import type { PluginManifest } from '@proctira/backend-plugin';

const validManifest: PluginManifest = {
  name: 'test-plugin',
  owner: 'test-org',
  version: '1.0.0',
  supportedProductVersions: '>=1.0.0 <2.0.0',
  requiredPermissions: ['student.read'],
  requiredExtensionPoints: ['student.after-create'],
  tenantScopeBehavior: 'isolated',
  auditBehavior: 'Logs all operations performed by this plugin',
  runtimeDependencies: [],
};

describe('definePlugin', () => {
  it('should create a plugin definition with valid manifest', () => {
    const plugin = definePlugin({ manifest: validManifest });

    expect(plugin.manifest).toEqual(validManifest);
    expect(plugin.hooks).toEqual([]);
    expect(plugin.eventHandlers).toEqual([]);
    expect(plugin.uiSlots).toEqual([]);
  });

  it('should include hooks when provided', () => {
    const plugin = definePlugin({
      manifest: validManifest,
      hooks: [
        {
          extensionPointId: 'student.after-create',
          priority: 100,
          handler: async () => ({ success: true, executionTimeMs: 0 }),
        },
      ],
    });

    expect(plugin.hooks).toHaveLength(1);
    expect(plugin.hooks[0]!.extensionPointId).toBe('student.after-create');
  });

  it('should include event handlers when provided', () => {
    const plugin = definePlugin({
      manifest: validManifest,
      eventHandlers: [
        {
          eventType: 'student.created',
          handler: async () => {},
        },
      ],
    });

    expect(plugin.eventHandlers).toHaveLength(1);
    expect(plugin.eventHandlers[0]!.eventType).toBe('student.created');
  });

  it('should include UI slots when provided', () => {
    const plugin = definePlugin({
      manifest: validManifest,
      uiSlots: [
        {
          slotId: 'dashboard-widget.main',
          componentId: 'my-widget',
          label: 'My Widget',
          order: 10,
        },
      ],
    });

    expect(plugin.uiSlots).toHaveLength(1);
    expect(plugin.uiSlots[0]!.slotId).toBe('dashboard-widget.main');
  });

  it('should include lifecycle callbacks when provided', () => {
    const onEnable = async () => {};
    const onDisable = async () => {};

    const plugin = definePlugin({
      manifest: validManifest,
      onEnable,
      onDisable,
    });

    expect(plugin.onEnable).toBe(onEnable);
    expect(plugin.onDisable).toBe(onDisable);
  });

  it('should throw if manifest is missing', () => {
    expect(() => definePlugin({} as any)).toThrow('Plugin manifest is required');
  });

  it('should throw if manifest.name is missing', () => {
    expect(() => definePlugin({ manifest: { ...validManifest, name: '' } })).toThrow(
      'Plugin manifest.name is required',
    );
  });

  it('should throw if manifest.version is missing', () => {
    expect(() => definePlugin({ manifest: { ...validManifest, version: '' } })).toThrow(
      'Plugin manifest.version is required',
    );
  });
});
