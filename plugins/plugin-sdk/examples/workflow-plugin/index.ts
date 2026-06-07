/**
 * Example: Workflow Plugin
 *
 * Demonstrates how to build a plugin that extends the workflow engine
 * with custom validation and transition logic.
 *
 * This plugin:
 * - Hooks into 'workflow-transition' to add custom approval rules
 * - Validates that transfers require a minimum enrollment duration
 * - Subscribes to workflow events for external system sync
 */
import { definePlugin, defineHook, defineEventHandler } from '../../src/index.js';
import type { HookResult, HookValidationError } from '../../src/index.js';

/** Minimum days a student must be enrolled before transfer is allowed */
const MIN_ENROLLMENT_DAYS = 30;

interface WorkflowTransitionPayload {
  entityId: string;
  entityType: string;
  fromState: string;
  toState: string;
  action: string;
  data: Record<string, unknown>;
}

export default definePlugin({
  manifest: {
    name: 'transfer-approval-rules',
    owner: 'proctira-official',
    version: '1.0.0',
    supportedProductVersions: '>=1.0.0 <2.0.0',
    requiredPermissions: [
      'workflow.read',
      'workflow.transition',
      'student.read',
      'enrollment.read',
    ],
    requiredExtensionPoints: [
      'workflow.before-transition',
    ],
    configSchema: {
      type: 'object',
      properties: {
        minEnrollmentDays: {
          type: 'number',
          description: 'Minimum enrollment days before transfer allowed',
          default: 30,
        },
        requirePrincipalApproval: {
          type: 'boolean',
          description: 'Whether principal approval is required for transfers',
          default: true,
        },
        externalSyncUrl: {
          type: 'string',
          description: 'URL to sync workflow transitions to external system',
        },
      },
    },
    runtimeDependencies: [],
    tenantScopeBehavior: 'isolated',
    auditBehavior: 'Logs all transfer validation decisions and external sync attempts',
  },

  hooks: [
    defineHook<WorkflowTransitionPayload>(
      'workflow.before-transition',
      async (payload, context): Promise<HookResult<WorkflowTransitionPayload>> => {
        // Only apply to student_transfer workflows
        if (payload.entityType !== 'student_transfer') {
          return { success: true, executionTimeMs: 1 };
        }

        const errors: HookValidationError[] = [];

        // Validate minimum enrollment duration
        const enrollmentStartDate = payload.data['enrollmentStartDate'] as string | undefined;
        if (enrollmentStartDate) {
          const start = new Date(enrollmentStartDate);
          const now = new Date();
          const daysDiff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

          if (daysDiff < MIN_ENROLLMENT_DAYS) {
            errors.push({
              field: 'enrollmentDuration',
              message: `Student must be enrolled for at least ${MIN_ENROLLMENT_DAYS} days before transfer. Current: ${daysDiff} days.`,
              code: 'INSUFFICIENT_ENROLLMENT_DURATION',
            });
          }
        }

        // Validate transfer reason is provided
        if (!payload.data['transferReason']) {
          errors.push({
            field: 'transferReason',
            message: 'Transfer reason is required for approval',
            code: 'MISSING_TRANSFER_REASON',
          });
        }

        if (errors.length > 0) {
          return {
            success: false,
            errors,
            abort: true,
            abortReason: 'Transfer validation failed',
            executionTimeMs: 5,
          };
        }

        return {
          success: true,
          data: payload,
          executionTimeMs: 5,
        };
      },
      { priority: 50 }, // High priority - validate before other handlers
    ),
  ],

  eventHandlers: [
    defineEventHandler(
      'workflow.transitioned',
      async (event, context): Promise<void> => {
        // Sync workflow transitions to external system
        if (event.data['entityType'] === 'student_transfer') {
          console.log(
            `[transfer-approval-rules] Transfer workflow transitioned: ` +
              `${event.data['fromState']} -> ${event.data['toState']} ` +
              `for entity ${event.entityId}`,
          );
          // In a real plugin, POST to externalSyncUrl
        }
      },
    ),
  ],
});
