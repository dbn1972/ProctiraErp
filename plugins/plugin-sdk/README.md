# @proctira/plugin-sdk

The official SDK for building plugins for the ProctiraERP Unified Platform.

## Installation

```bash
npm install @proctira/plugin-sdk
```

## Quick Start

```typescript
import { definePlugin, defineHook, defineEventHandler } from '@proctira/plugin-sdk';

export default definePlugin({
  manifest: {
    name: 'my-plugin',
    owner: 'my-org',
    version: '1.0.0',
    supportedProductVersions: '>=1.0.0 <2.0.0',
    requiredPermissions: ['student.read'],
    requiredExtensionPoints: ['student.after-create'],
    tenantScopeBehavior: 'isolated',
    auditBehavior: 'Logs all operations',
    runtimeDependencies: [],
  },
  hooks: [
    defineHook('student.after-create', async (payload, context) => {
      return { success: true, executionTimeMs: 0 };
    }),
  ],
});
```

## Features

- **Type-safe plugin definition** with `definePlugin`, `defineHook`, `defineEventHandler`, `defineUISlot`
- **Manifest validation** against the platform schema
- **Testing harness** for plugin validation without a running platform
- **Development server** with hot reload for rapid iteration
- **CLI tools** for scaffolding, validation, and building
- **Example plugins** demonstrating common patterns

## Documentation

See [docs/PLUGIN_DEVELOPMENT_GUIDE.md](./docs/PLUGIN_DEVELOPMENT_GUIDE.md) for the complete development guide.

## CLI

```bash
npx proctira-plugin init       # Create a new plugin
npx proctira-plugin dev        # Start dev server with hot reload
npx proctira-plugin validate   # Validate manifest
npx proctira-plugin test       # Run test harness
npx proctira-plugin build      # Build for distribution
```

## Testing

```typescript
import { createTestHarness } from '@proctira/plugin-sdk/testing';
import myPlugin from './src/index';

const harness = createTestHarness(myPlugin);
const result = harness.validateManifest();
await harness.invokeHook('student.after-create', payload);
```

## Examples

- `examples/notification-plugin` — Event-driven notifications
- `examples/workflow-plugin` — Custom workflow validation
- `examples/export-plugin` — Custom export formats
