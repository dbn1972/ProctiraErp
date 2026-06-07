/**
 * Example: Notification Plugin
 *
 * Demonstrates how to build a plugin that sends notifications
 * when specific domain events occur (e.g., student absence threshold exceeded).
 *
 * This plugin:
 * - Subscribes to the 'attendance.threshold-exceeded' event
 * - Hooks into 'student.after-create' to send a welcome notification
 * - Registers a dashboard widget UI slot
 */
import { definePlugin, defineHook, defineEventHandler, defineUISlot } from '../../src/index.js';
import type { HookResult, DomainEventPayload, HookContext } from '../../src/index.js';

export default definePlugin({
  manifest: {
    name: 'attendance-notifier',
    owner: 'proctira-official',
    version: '1.0.0',
    supportedProductVersions: '>=1.0.0 <2.0.0',
    requiredPermissions: [
      'attendance.read',
      'notification.send',
      'student.read',
    ],
    requiredExtensionPoints: [
      'student.after-create',
    ],
    configSchema: {
      type: 'object',
      properties: {
        webhookUrl: { type: 'string', description: 'External webhook URL for notifications' },
        thresholdPercentage: { type: 'number', description: 'Absence threshold percentage', default: 20 },
        notifyGuardians: { type: 'boolean', description: 'Whether to notify guardians', default: true },
      },
      required: ['webhookUrl'],
    },
    runtimeDependencies: [],
    tenantScopeBehavior: 'isolated',
    auditBehavior: 'Logs all notification sends including recipient, channel, and delivery status',
  },

  hooks: [
    defineHook<{ entityId: string; data: Record<string, unknown> }>(
      'student.after-create',
      async (payload, context): Promise<HookResult> => {
        // Send a welcome notification when a new student is created
        console.log(`[attendance-notifier] Welcome notification for student ${payload.entityId}`);
        return {
          success: true,
          executionTimeMs: 10,
        };
      },
      { priority: 200 }, // Low priority - runs after core handlers
    ),
  ],

  eventHandlers: [
    defineEventHandler(
      'attendance.threshold-exceeded',
      async (event: DomainEventPayload, context: HookContext): Promise<void> => {
        // When a student exceeds the absence threshold, notify relevant parties
        const { entityId, data } = event;
        console.log(
          `[attendance-notifier] Student ${entityId} exceeded absence threshold. ` +
            `Current: ${data['currentPercentage']}%, Threshold: ${data['threshold']}%`,
        );
        // In a real plugin, this would call the notification service API
      },
      { filter: { 'data.severity': 'high' } },
    ),
  ],

  uiSlots: [
    defineUISlot('dashboard-widget.main', 'attendance-alert-widget', {
      label: 'Attendance Alerts',
      icon: 'bell-alert',
      order: 20,
    }),
  ],

  async onEnable(context) {
    context.logger.info('Attendance Notifier plugin enabled', {
      tenantId: context.tenantId,
      webhookUrl: context.configuration['webhookUrl'] as string,
    });
  },

  async onDisable(context) {
    context.logger.info('Attendance Notifier plugin disabled', {
      tenantId: context.tenantId,
    });
  },
});
