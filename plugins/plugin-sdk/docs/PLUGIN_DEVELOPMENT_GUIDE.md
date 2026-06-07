# ProctiraERP Plugin Development Guide

## Overview

The ProctiraERP Plugin SDK enables developers to extend the platform with custom functionality. Plugins can hook into platform extension points, subscribe to domain events, register UI components, and add custom export formats — all within a secure, tenant-isolated sandbox.

## Quick Start

### 1. Create a New Plugin

```bash
npx @proctira/plugin-sdk init my-plugin
cd my-plugin
npm install
```

This scaffolds a new plugin project with:
- `manifest.json` — Plugin metadata and permissions
- `src/index.ts` — Plugin entry point
- `src/handlers/` — Hook and event handler implementations
- `tests/` — Test harness setup
- `package.json` — Dependencies including the SDK

### 2. Define Your Plugin

```typescript
// src/index.ts
import { definePlugin, defineHook, defineEventHandler } from '@proctira/plugin-sdk';

export default definePlugin({
  manifest: {
    name: 'my-plugin',
    owner: 'my-organization',
    version: '1.0.0',
    supportedProductVersions: '>=1.0.0 <2.0.0',
    requiredPermissions: ['student.read'],
    requiredExtensionPoints: ['student.after-create'],
    tenantScopeBehavior: 'isolated',
    auditBehavior: 'Logs all operations for compliance',
    runtimeDependencies: [],
  },
  hooks: [
    defineHook('student.after-create', async (payload, context) => {
      // Your logic here
      return { success: true, executionTimeMs: 0 };
    }),
  ],
});
```

### 3. Run in Development Mode

```bash
npx proctira-plugin dev
```

This starts a development server with hot reload that watches your source files and validates your manifest on each change.

### 4. Test Your Plugin

```typescript
// tests/plugin.test.ts
import { createTestHarness } from '@proctira/plugin-sdk/testing';
import myPlugin from '../src/index';

describe('My Plugin', () => {
  const harness = createTestHarness(myPlugin);

  it('should have a valid manifest', () => {
    const result = harness.validateManifest();
    expect(result.valid).toBe(true);
  });

  it('should handle student creation', async () => {
    const result = await harness.invokeHook('student.after-create', {
      entityId: 'student-123',
      data: { name: 'Jane Doe' },
    });
    expect(result.success).toBe(true);
  });
});
```

### 5. Validate Before Submission

```bash
npx proctira-plugin validate
```

---

## Plugin Manifest

The manifest is the contract between your plugin and the platform. It declares what your plugin needs and how it behaves.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique plugin name (kebab-case, a-z0-9-) |
| `owner` | string | Organization or developer name |
| `version` | string | Semantic version (e.g., "1.0.0") |
| `supportedProductVersions` | string | Semver range for platform compatibility |
| `requiredPermissions` | string[] | Permissions the plugin needs |
| `requiredExtensionPoints` | string[] | Extension points the plugin uses |
| `tenantScopeBehavior` | "isolated" \| "shared" | Data isolation model |
| `auditBehavior` | string | Description of audited actions |
| `runtimeDependencies` | string[] | Other plugins this depends on |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `configSchema` | object | JSON Schema for tenant-provided configuration |

### Name Rules

- Must be lowercase with hyphens only: `^[a-z0-9-]+$`
- Maximum 128 characters
- Must be unique across the platform registry

### Version Rules

- Must follow semantic versioning: `MAJOR.MINOR.PATCH`
- Pre-release versions supported: `1.0.0-beta.1`

---

## Extension Points

Extension points are explicit, versioned hooks that plugins can subscribe to. Each has a stability rating and required permissions.

### Available Hook Types

| Hook Type | Description | Mutable | Synchronous |
|-----------|-------------|---------|-------------|
| `before-create` | Runs before entity creation | Yes | Yes |
| `after-create` | Runs after entity creation | No | No |
| `before-update` | Runs before entity update | Yes | Yes |
| `after-update` | Runs after entity update | No | No |
| `before-delete` | Runs before entity deletion | Yes | Yes |
| `after-delete` | Runs after entity deletion | No | No |
| `validation` | Custom validation logic | No | Yes |
| `notification` | Notification triggers | No | No |
| `export` | Custom export formats | Yes | Yes |
| `workflow-transition` | Workflow state changes | Yes | Yes |

### Hook Handler Signature

```typescript
import { defineHook } from '@proctira/plugin-sdk';
import type { HookResult } from '@proctira/plugin-sdk';

const myHook = defineHook(
  'student.before-create',  // Extension point ID
  async (payload, context) => {
    // payload: The data being processed
    // context: { tenantId, actorId, extensionPointId, correlationId, timestamp }

    // For validation hooks, return errors:
    if (!payload.data.email) {
      return {
        success: false,
        errors: [{ field: 'email', message: 'Email is required', code: 'REQUIRED' }],
        abort: true,
        abortReason: 'Validation failed',
        executionTimeMs: 2,
      };
    }

    // For mutable hooks, return modified data:
    return {
      success: true,
      data: { ...payload, data: { ...payload.data, processed: true } },
      executionTimeMs: 5,
    };
  },
  { priority: 50 }  // Lower = runs earlier (default: 100)
);
```

---

## Domain Events

Plugins can subscribe to approved domain events for reactive behavior.

### Available Events

| Event | Entity | Description |
|-------|--------|-------------|
| `student.created` | Student | New student record created |
| `student.updated` | Student | Student record modified |
| `student.transferred` | Student | Student transferred between institutions |
| `student.enrolled` | Student | Student enrolled in a class |
| `student.graduated` | Student | Student graduated |
| `staff.created` | Staff | New staff record created |
| `staff.updated` | Staff | Staff record modified |
| `staff.assigned` | Staff | Staff assigned to institution/class |
| `institution.created` | Institution | New institution created |
| `institution.updated` | Institution | Institution record modified |
| `institution.deactivated` | Institution | Institution deactivated |
| `enrollment.created` | Enrollment | New enrollment created |
| `enrollment.status-changed` | Enrollment | Enrollment status changed |
| `attendance.recorded` | Attendance | Attendance record created |
| `attendance.threshold-exceeded` | Attendance | Absence threshold exceeded |
| `assessment.result-entered` | Assessment | Assessment result entered |
| `assessment.grade-calculated` | Assessment | Grade calculated |
| `examination.result-published` | Examination | Exam results published |
| `workflow.transitioned` | Workflow | Workflow state transitioned |
| `workflow.escalated` | Workflow | Workflow item escalated |
| `notification.sent` | Notification | Notification sent |
| `notification.delivered` | Notification | Notification delivered |
| `report.generated` | Report | Report generated |
| `import.completed` | Import | Bulk import completed |
| `export.completed` | Export | Data export completed |

### Event Handler Signature

```typescript
import { defineEventHandler } from '@proctira/plugin-sdk';

const onTransfer = defineEventHandler(
  'student.transferred',
  async (event, context) => {
    // event: { eventType, tenantId, entityId, entityType, actorId, timestamp, data, correlationId }
    // context: { tenantId, actorId, extensionPointId, correlationId, timestamp }

    console.log(`Student ${event.entityId} transferred`);
    console.log(`From: ${event.data.sourceInstitutionId}`);
    console.log(`To: ${event.data.destinationInstitutionId}`);
  },
  { filter: { 'data.reason': 'relocation' } }  // Optional: only receive matching events
);
```

---

## UI Slots

Plugins can register frontend components in designated UI extension slots.

### Available Slot Locations

| Location | Description |
|----------|-------------|
| `dashboard-widget` | Dashboard widget area |
| `entity-detail-tab` | Tab in entity detail view |
| `entity-detail-sidebar` | Sidebar in entity detail view |
| `entity-list-action` | Action button in entity list |
| `navigation-menu-item` | Navigation menu entry |
| `settings-panel` | Settings configuration panel |
| `report-section` | Report configuration section |
| `form-section` | Form extension section |

### Registering a UI Slot

```typescript
import { defineUISlot } from '@proctira/plugin-sdk';

const widget = defineUISlot(
  'dashboard-widget.main',    // Slot ID
  'my-attendance-widget',     // Component ID (loaded by frontend)
  {
    label: 'Attendance Overview',
    icon: 'chart-bar',
    order: 20,  // Lower = appears first
  }
);
```

---

## Plugin Configuration

Plugins can declare a configuration schema that tenant admins fill in during installation.

```typescript
export default definePlugin({
  manifest: {
    // ...
    configSchema: {
      type: 'object',
      properties: {
        webhookUrl: {
          type: 'string',
          description: 'URL to send notifications to',
        },
        threshold: {
          type: 'number',
          description: 'Alert threshold percentage',
          default: 20,
          minimum: 1,
          maximum: 100,
        },
        enabled: {
          type: 'boolean',
          description: 'Whether alerts are active',
          default: true,
        },
      },
      required: ['webhookUrl'],
    },
  },
});
```

Configuration values are available in hook/event handler contexts and lifecycle callbacks.

---

## Testing

The SDK provides a comprehensive testing harness for validating plugins without a running platform.

### Test Harness API

```typescript
import { createTestHarness } from '@proctira/plugin-sdk/testing';

const harness = createTestHarness(myPlugin, {
  tenantId: 'test-tenant',
  actorId: 'test-user',
  configuration: { webhookUrl: 'https://example.com' },
});

// Validate manifest
harness.validateManifest();

// Invoke hooks
await harness.invokeHook('student.after-create', payload);

// Invoke event handlers
await harness.invokeEventHandler('student.created', eventData);

// Check registrations
harness.getRegisteredHooks();
harness.getRegisteredEvents();
harness.requiresPermission('student.read');
harness.requiresExtensionPoint('student.after-create');

// Lifecycle simulation
await harness.simulateEnable();
await harness.simulateDisable();
```

### Mock Utilities

```typescript
import { mockHookContext, mockEventPayload } from '@proctira/plugin-sdk/testing';

// Create a mock hook context
const context = mockHookContext({
  tenantId: 'my-tenant',
  actorId: 'user-123',
});

// Create a mock event payload
const event = mockEventPayload('student.created', {
  entityId: 'student-456',
  data: { name: 'Jane Doe' },
});
```

### Assertions

```typescript
import { assertHookResult, assertPluginManifest } from '@proctira/plugin-sdk/testing';

// Assert hook result is successful
assertHookResult(result, {
  success: true,
  noErrors: true,
  noAbort: true,
  maxExecutionTimeMs: 1000,
});

// Assert manifest is valid
assertPluginManifest(myPlugin.manifest);
```

---

## Security and Sandbox

All plugins execute within a sandboxed environment with strict resource limits:

| Resource | Default Limit |
|----------|---------------|
| Memory | 64 MB |
| CPU Time | 5,000 ms |
| Wall Clock Time | 30,000 ms |
| Network Requests | 10 per execution |
| Network Hosts | Explicitly allowed only |
| Filesystem | No access |
| Secrets | No access |

### Security Rules

1. **Tenant Isolation**: Plugin data access is scoped to the declaring tenant
2. **No Filesystem Access**: Plugins cannot read or write files
3. **No Unrestricted Network**: Only explicitly allowed hosts
4. **No Secret Access**: Plugins cannot access platform secrets
5. **Audit Visibility**: All plugin actions are logged and auditable
6. **Permission Consent**: Users must consent to all required permissions

---

## Lifecycle

1. **Register**: Plugin is submitted to the registry with manifest validation
2. **Install**: Tenant admin installs the plugin with permission consent
3. **Enable**: Plugin is activated and begins receiving hooks/events
4. **Disable**: Plugin is deactivated (hooks/events stop)
5. **Uninstall**: Plugin is removed and all permissions revoked

---

## Best Practices

1. **Declare minimal permissions** — Only request what you need
2. **Handle errors gracefully** — Always return proper HookResult objects
3. **Keep execution fast** — Hooks have timeout limits
4. **Use isolated tenant scope** — Unless you have a specific cross-tenant need
5. **Write comprehensive audit descriptions** — Explain what your plugin logs
6. **Test with the harness** — Validate all hooks and events before submission
7. **Version your plugin** — Follow semver for compatibility
8. **Document configuration** — Use configSchema with descriptions and defaults

---

## Examples

See the `examples/` directory for complete plugin implementations:

- **notification-plugin** — Sends notifications on attendance threshold events
- **workflow-plugin** — Adds custom transfer approval validation rules
- **export-plugin** — Adds a custom CSV export format with configuration
