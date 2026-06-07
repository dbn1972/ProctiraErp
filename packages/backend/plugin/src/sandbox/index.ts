/**
 * Plugin Sandbox Module
 *
 * Provides isolated execution environments for plugin code:
 * - PluginSandbox: Worker thread-based isolation (production, untrusted code)
 * - InProcessSandbox: VM-based isolation (testing, trusted code)
 *
 * Both implementations enforce:
 * - Resource quotas (memory, CPU, network)
 * - Tenant-scoped data access
 * - No filesystem/secret access
 * - Full audit visibility
 */

export { PluginSandbox } from './plugin-sandbox.js';
export { InProcessSandbox } from './in-process-sandbox.js';

export type {
  ResourceQuota,
  SandboxExecutionContext,
  SandboxExecutionResult,
  SandboxOptions,
  SandboxAuditRecord,
  SandboxWorkerMessage,
  SandboxWorkerResponse,
  SandboxViolation,
} from './types.js';

export { DEFAULT_RESOURCE_QUOTA } from './types.js';
