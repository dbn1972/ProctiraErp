/**
 * Built-in Extension Point Definitions
 *
 * Pre-registered extension points, UI slots, and event definitions
 * that ship with the platform. These define the governed contracts
 * that plugins can hook into.
 *
 * Each definition includes:
 * - Version (semver)
 * - Stability rating
 * - Required permissions
 * - Payload/return schemas
 * - Behavioral documentation
 */
import type {
  ExtensionPointDefinition,
  UISlotDefinition,
  EventSubscriptionDefinition,
} from './types.js';

// ─── Hook Extension Points ──────────────────────────────────────────────────

/**
 * Built-in hook extension points organized by entity type.
 */
export const BUILT_IN_EXTENSION_POINTS: ExtensionPointDefinition[] = [
  // ── Student Hooks ─────────────────────────────────────────────────────────
  {
    id: 'student.before-create',
    name: 'Before Student Create',
    description:
      'Invoked before a student record is persisted. ' +
      'Handlers can modify the payload or abort the operation.',
    hookType: 'before-create',
    entityType: 'student',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['student.write'],
    payloadSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        dateOfBirth: { type: 'string', format: 'date' },
        gender: { type: 'string' },
        nationalId: { type: 'string' },
      },
    },
    returnSchema: { type: 'object', description: 'Modified student data' },
    mutable: true,
    synchronous: true,
    timeoutMs: 5000,
    introducedIn: '1.0.0',
    deprecatedIn: null,
    replacedBy: null,
  },
  {
    id: 'student.after-create',
    name: 'After Student Create',
    description:
      'Invoked after a student record is successfully persisted. ' +
      'Handlers receive the created record. Read-only, fire-and-forget.',
    hookType: 'after-create',
    entityType: 'student',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['student.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        dateOfBirth: { type: 'string', format: 'date' },
      },
    },
    returnSchema: null,
    mutable: false,
    synchronous: false,
    timeoutMs: 10000,
    introducedIn: '1.0.0',
    deprecatedIn: null,
    replacedBy: null,
  },
  {
    id: 'student.validation',
    name: 'Student Validation',
    description:
      'Invoked during student record validation. ' +
      'Handlers can return additional validation errors.',
    hookType: 'validation',
    entityType: 'student',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['student.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        dateOfBirth: { type: 'string', format: 'date' },
        custom_data: { type: 'object' },
      },
    },
    returnSchema: {
      type: 'object',
      properties: {
        errors: { type: 'array', items: { type: 'object' } },
      },
    },
    mutable: false,
    synchronous: true,
    timeoutMs: 3000,
    introducedIn: '1.0.0',
    deprecatedIn: null,
    replacedBy: null,
  },
  // ── Institution Hooks ──────────────────────────────────────────────────────
  {
    id: 'institution.before-create',
    name: 'Before Institution Create',
    description:
      'Invoked before an institution record is persisted. ' +
      'Handlers can modify the payload or abort the operation.',
    hookType: 'before-create',
    entityType: 'institution',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['institution.write'],
    payloadSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        code: { type: 'string' },
        areaId: { type: 'string', format: 'uuid' },
      },
    },
    returnSchema: { type: 'object', description: 'Modified institution data' },
    mutable: true,
    synchronous: true,
    timeoutMs: 5000,
    introducedIn: '1.0.0',
    deprecatedIn: null,
    replacedBy: null,
  },
  {
    id: 'institution.after-create',
    name: 'After Institution Create',
    description:
      'Invoked after an institution record is successfully persisted. ' +
      'Read-only, fire-and-forget.',
    hookType: 'after-create',
    entityType: 'institution',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['institution.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        code: { type: 'string' },
      },
    },
    returnSchema: null,
    mutable: false,
    synchronous: false,
    timeoutMs: 10000,
    introducedIn: '1.0.0',
    deprecatedIn: null,
    replacedBy: null,
  },
  // ── Notification Hook ──────────────────────────────────────────────────────
  {
    id: 'notification.before-send',
    name: 'Before Notification Send',
    description:
      'Invoked before a notification is dispatched. ' +
      'Handlers can modify recipients, template variables, or abort.',
    hookType: 'notification',
    entityType: 'notification',
    version: '1.0.0',
    stability: 'beta',
    requiredPermissions: ['notification.write'],
    payloadSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['email', 'in_app', 'push', 'webhook'] },
        templateId: { type: 'string' },
        recipients: { type: 'array' },
        variables: { type: 'object' },
      },
    },
    returnSchema: { type: 'object', description: 'Modified notification payload' },
    mutable: true,
    synchronous: true,
    timeoutMs: 3000,
    introducedIn: '1.0.0',
    deprecatedIn: null,
    replacedBy: null,
  },
  // ── Export Hook ───────────────────────────────────────────────────────────
  {
    id: 'export.before-generate',
    name: 'Before Export Generate',
    description:
      'Invoked before a report/export is generated. ' +
      'Handlers can add custom columns, modify filters, or inject data.',
    hookType: 'export',
    entityType: 'report',
    version: '1.0.0',
    stability: 'beta',
    requiredPermissions: ['report.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        reportType: { type: 'string' },
        format: { type: 'string', enum: ['xlsx', 'pdf', 'csv'] },
        filters: { type: 'object' },
      },
    },
    returnSchema: { type: 'object', description: 'Modified export configuration' },
    mutable: true,
    synchronous: true,
    timeoutMs: 5000,
    introducedIn: '1.0.0',
    deprecatedIn: null,
    replacedBy: null,
  },
  // ── Workflow Transition Hook ────────────────────────────────────────────────
  {
    id: 'workflow.before-transition',
    name: 'Before Workflow Transition',
    description:
      'Invoked before a workflow state transition occurs. ' +
      'Handlers can validate conditions, modify data, or abort the transition.',
    hookType: 'workflow-transition',
    entityType: 'workflow',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['workflow.write'],
    payloadSchema: {
      type: 'object',
      properties: {
        instanceId: { type: 'string', format: 'uuid' },
        fromState: { type: 'string' },
        toState: { type: 'string' },
        action: { type: 'string' },
        entityType: { type: 'string' },
        entityId: { type: 'string', format: 'uuid' },
      },
    },
    returnSchema: { type: 'object', description: 'Modified transition data or abort signal' },
    mutable: true,
    synchronous: true,
    timeoutMs: 5000,
    introducedIn: '1.0.0',
    deprecatedIn: null,
    replacedBy: null,
  },
  {
    id: 'workflow.after-transition',
    name: 'After Workflow Transition',
    description:
      'Invoked after a workflow state transition completes. ' +
      'Read-only, fire-and-forget. Use for side effects like notifications.',
    hookType: 'workflow-transition',
    entityType: 'workflow',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['workflow.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        instanceId: { type: 'string', format: 'uuid' },
        fromState: { type: 'string' },
        toState: { type: 'string' },
        action: { type: 'string' },
        entityType: { type: 'string' },
        entityId: { type: 'string', format: 'uuid' },
        actor: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
    returnSchema: null,
    mutable: false,
    synchronous: false,
    timeoutMs: 10000,
    introducedIn: '1.0.0',
    deprecatedIn: null,
    replacedBy: null,
  },
];

// ─── Built-in UI Slot Definitions ───────────────────────────────────────────

/**
 * Built-in UI slot definitions for frontend extension points.
 */
export const BUILT_IN_UI_SLOTS: UISlotDefinition[] = [
  {
    id: 'dashboard.widget',
    name: 'Dashboard Widget',
    description: 'Widget slot on the main dashboard. Plugins can add custom widgets.',
    location: 'dashboard-widget',
    entityType: 'dashboard',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['ui.dashboard'],
    maxRegistrations: 10,
    propsSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        userId: { type: 'string' },
        locale: { type: 'string' },
      },
    },
  },
  {
    id: 'student-detail.tab',
    name: 'Student Detail Tab',
    description: 'Additional tab on the student detail page.',
    location: 'entity-detail-tab',
    entityType: 'student',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['student.read', 'ui.student-detail'],
    maxRegistrations: 5,
    propsSchema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        tenantId: { type: 'string' },
        locale: { type: 'string' },
      },
    },
  },
  {
    id: 'student-detail.sidebar',
    name: 'Student Detail Sidebar',
    description: 'Sidebar panel on the student detail page.',
    location: 'entity-detail-sidebar',
    entityType: 'student',
    version: '1.0.0',
    stability: 'beta',
    requiredPermissions: ['student.read', 'ui.student-detail'],
    maxRegistrations: 3,
    propsSchema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        tenantId: { type: 'string' },
      },
    },
  },
  {
    id: 'institution-detail.tab',
    name: 'Institution Detail Tab',
    description: 'Additional tab on the institution detail page.',
    location: 'entity-detail-tab',
    entityType: 'institution',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['institution.read', 'ui.institution-detail'],
    maxRegistrations: 5,
    propsSchema: {
      type: 'object',
      properties: {
        institutionId: { type: 'string' },
        tenantId: { type: 'string' },
        locale: { type: 'string' },
      },
    },
  },
  {
    id: 'navigation.menu-item',
    name: 'Navigation Menu Item',
    description: 'Custom menu item in the main navigation sidebar.',
    location: 'navigation-menu-item',
    entityType: 'navigation',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['ui.navigation'],
    maxRegistrations: 10,
    propsSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        userId: { type: 'string' },
        locale: { type: 'string' },
        userRoles: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    id: 'settings.panel',
    name: 'Settings Panel',
    description: 'Custom settings panel in the admin settings area.',
    location: 'settings-panel',
    entityType: 'settings',
    version: '1.0.0',
    stability: 'beta',
    requiredPermissions: ['admin.settings', 'ui.settings'],
    maxRegistrations: 20,
    propsSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        locale: { type: 'string' },
      },
    },
  },
];

// ─── Built-in Event Subscription Definitions ────────────────────────────────

/**
 * Approved domain events that plugins can subscribe to.
 * Only events listed here can be subscribed to by plugins.
 */
export const BUILT_IN_EVENT_DEFINITIONS: EventSubscriptionDefinition[] = [
  {
    eventType: 'student.created',
    name: 'Student Created',
    description: 'Fired when a new student record is created.',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['student.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        institutionId: { type: 'string', format: 'uuid' },
      },
    },
    entityType: 'student',
  },
  {
    eventType: 'student.updated',
    name: 'Student Updated',
    description: 'Fired when a student record is modified.',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['student.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        changedFields: { type: 'array', items: { type: 'string' } },
      },
    },
    entityType: 'student',
  },
  {
    eventType: 'student.transferred',
    name: 'Student Transferred',
    description: 'Fired when a student is transferred between institutions.',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['student.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        studentId: { type: 'string', format: 'uuid' },
        sourceInstitutionId: { type: 'string', format: 'uuid' },
        destinationInstitutionId: { type: 'string', format: 'uuid' },
      },
    },
    entityType: 'student',
  },
  {
    eventType: 'institution.created',
    name: 'Institution Created',
    description: 'Fired when a new institution is created.',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['institution.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        areaId: { type: 'string', format: 'uuid' },
      },
    },
    entityType: 'institution',
  },
  {
    eventType: 'institution.deactivated',
    name: 'Institution Deactivated',
    description: 'Fired when an institution is deactivated.',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['institution.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        reason: { type: 'string' },
      },
    },
    entityType: 'institution',
  },
  {
    eventType: 'workflow.transitioned',
    name: 'Workflow Transitioned',
    description: 'Fired when a workflow instance transitions between states.',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['workflow.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        instanceId: { type: 'string', format: 'uuid' },
        fromState: { type: 'string' },
        toState: { type: 'string' },
        action: { type: 'string' },
        entityType: { type: 'string' },
        entityId: { type: 'string', format: 'uuid' },
      },
    },
    entityType: 'workflow',
  },
  {
    eventType: 'attendance.threshold-exceeded',
    name: 'Attendance Threshold Exceeded',
    description: 'Fired when a student exceeds the absence threshold.',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['attendance.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        studentId: { type: 'string', format: 'uuid' },
        threshold: { type: 'number' },
        actualAbsences: { type: 'number' },
        periodId: { type: 'string', format: 'uuid' },
      },
    },
    entityType: 'attendance',
  },
  {
    eventType: 'assessment.result-entered',
    name: 'Assessment Result Entered',
    description: 'Fired when assessment results are entered for a student.',
    version: '1.0.0',
    stability: 'stable',
    requiredPermissions: ['assessment.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        studentId: { type: 'string', format: 'uuid' },
        subjectId: { type: 'string', format: 'uuid' },
        periodId: { type: 'string', format: 'uuid' },
        score: { type: 'number' },
      },
    },
    entityType: 'assessment',
  },
  {
    eventType: 'notification.sent',
    name: 'Notification Sent',
    description: 'Fired when a notification is dispatched.',
    version: '1.0.0',
    stability: 'beta',
    requiredPermissions: ['notification.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        notificationId: { type: 'string', format: 'uuid' },
        channel: { type: 'string' },
        templateId: { type: 'string' },
        recipientCount: { type: 'number' },
      },
    },
    entityType: 'notification',
  },
  {
    eventType: 'import.completed',
    name: 'Import Completed',
    description: 'Fired when a bulk import operation completes.',
    version: '1.0.0',
    stability: 'beta',
    requiredPermissions: ['import.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string' },
        totalRows: { type: 'number' },
        successCount: { type: 'number' },
        errorCount: { type: 'number' },
      },
    },
    entityType: 'import',
  },
  {
    eventType: 'export.completed',
    name: 'Export Completed',
    description: 'Fired when a report/export generation completes.',
    version: '1.0.0',
    stability: 'beta',
    requiredPermissions: ['report.read'],
    payloadSchema: {
      type: 'object',
      properties: {
        reportType: { type: 'string' },
        format: { type: 'string' },
        rowCount: { type: 'number' },
      },
    },
    entityType: 'report',
  },
];
