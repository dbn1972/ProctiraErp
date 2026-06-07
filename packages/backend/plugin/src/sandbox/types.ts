/**
 * Plugin Sandbox Types
 *
 * Type definitions for the plugin sandbox runtime, including
 * resource quotas, execution contexts, and audit records.
 */

/**
 * Resource quota configuration for a sandboxed plugin execution.
 */
export interface ResourceQuota {
  /** Maximum memory in bytes (default: 64MB) */
  maxMemoryBytes: number;
  /** Maximum CPU time in milliseconds (default: 5000ms) */
  maxCpuTimeMs: number;
  /** Maximum execution wall-clock time in milliseconds (default: 30000ms) */
  maxWallTimeMs: number;
  /** Allowed network hosts (empty = no network access) */
  allowedNetworkHosts: string[];
  /** Maximum number of network requests per execution (default: 10) */
  maxNetworkRequests: number;
}

/**
 * Default resource quotas for plugin execution.
 */
export const DEFAULT_RESOURCE_QUOTA: ResourceQuota = {
  maxMemoryBytes: 64 * 1024 * 1024, // 64MB
  maxCpuTimeMs: 5000,
  maxWallTimeMs: 30000,
  allowedNetworkHosts: [],
  maxNetworkRequests: 10,
};

/**
 * Execution context passed to the sandboxed plugin code.
 * Provides tenant-scoped data access and approved APIs.
 */
export interface SandboxExecutionContext {
  /** The tenant ID this execution is scoped to */
  tenantId: string;
  /** The plugin ID being executed */
  pluginId: string;
  /** The install ID for this tenant */
  installId: string;
  /** Permissions granted to this plugin */
  grantedPermissions: string[];
  /** Configuration provided by the tenant */
  configuration: Record<string, unknown>;
  /** Correlation ID for tracing */
  correlationId: string;
}

/**
 * The message sent to the worker thread to start execution.
 */
export interface SandboxWorkerMessage {
  type: 'execute';
  /** The plugin code to execute (as a string module) */
  code: string;
  /** The handler function name to invoke */
  handler: string;
  /** Arguments to pass to the handler */
  args: unknown[];
  /** Execution context */
  context: SandboxExecutionContext;
  /** Resource quotas */
  quota: ResourceQuota;
}

/**
 * Response from the worker thread after execution.
 */
export interface SandboxWorkerResponse {
  type: 'success' | 'error' | 'timeout' | 'oom';
  /** The result value (if success) */
  result?: unknown;
  /** Error message (if error/timeout/oom) */
  error?: string;
  /** Stack trace (if error) */
  stack?: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Memory usage in bytes at peak */
  peakMemoryBytes: number;
  /** Number of network requests made */
  networkRequestCount: number;
}

/**
 * Audit record for a plugin sandbox execution.
 */
export interface SandboxAuditRecord {
  /** Unique ID for this audit record */
  id: string;
  /** Plugin ID */
  pluginId: string;
  /** Tenant ID */
  tenantId: string;
  /** Install ID */
  installId: string;
  /** Correlation ID for tracing */
  correlationId: string;
  /** The handler that was invoked */
  handler: string;
  /** Execution outcome */
  outcome: 'success' | 'error' | 'timeout' | 'oom' | 'permission_denied' | 'quota_exceeded';
  /** Duration in milliseconds */
  durationMs: number;
  /** Peak memory usage */
  peakMemoryBytes: number;
  /** Network requests made */
  networkRequestCount: number;
  /** Error message if failed */
  errorMessage?: string;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Options for creating a sandbox instance.
 */
export interface SandboxOptions {
  /** Resource quotas (uses defaults if not provided) */
  quota?: Partial<ResourceQuota>;
  /** Whether to enable network access (default: false) */
  enableNetwork?: boolean;
  /** Audit callback for recording execution events */
  onAudit?: (record: SandboxAuditRecord) => void | Promise<void>;
}

/**
 * Result of a sandbox execution.
 */
export interface SandboxExecutionResult<T = unknown> {
  /** Whether execution succeeded */
  success: boolean;
  /** The return value (if success) */
  result?: T;
  /** Error details (if failed) */
  error?: {
    message: string;
    code: 'EXECUTION_ERROR' | 'TIMEOUT' | 'OOM' | 'PERMISSION_DENIED' | 'QUOTA_EXCEEDED' | 'CRASH';
    stack?: string;
  };
  /** Execution metrics */
  metrics: {
    durationMs: number;
    peakMemoryBytes: number;
    networkRequestCount: number;
  };
}

/**
 * Sandbox violation types that can occur during execution.
 */
export type SandboxViolation =
  | 'filesystem_access'
  | 'unrestricted_network'
  | 'secret_access'
  | 'memory_exceeded'
  | 'cpu_exceeded'
  | 'wall_time_exceeded'
  | 'network_quota_exceeded'
  | 'unauthorized_host'
  | 'cross_tenant_access';
