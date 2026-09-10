/**
 * Plugin Sandbox Worker
 *
 * This module runs inside a Worker thread and provides the isolated
 * execution environment for plugin code. It:
 * - Restricts access to Node.js built-in modules (fs, child_process, etc.)
 * - Enforces network access controls
 * - Monitors memory usage
 * - Provides a tenant-scoped API surface to plugin code
 * - Reports execution results back to the parent thread
 */
import { parentPort, workerData } from 'node:worker_threads';
import { createContext, Script } from 'node:vm';

import type {
  SandboxWorkerMessage,
  SandboxWorkerResponse,
  SandboxExecutionContext,
  ResourceQuota,
} from './types.js';

/**
 * Blocked modules that plugins cannot access.
 */
const BLOCKED_MODULES = new Set([
  'fs',
  'fs/promises',
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'net',
  'tls',
  'http',
  'https',
  'http2',
  'os',
  'path',
  'process',
  'worker_threads',
  'v8',
  'vm',
  'crypto',
  'readline',
  'repl',
  'inspector',
  'perf_hooks',
  'trace_events',
  'wasi',
]);

/**
 * Creates a restricted require function that blocks dangerous modules.
 */
function createRestrictedRequire(allowedNetworkHosts: string[]): (module: string) => unknown {
  return (moduleName: string): unknown => {
    if (BLOCKED_MODULES.has(moduleName)) {
      throw new Error(`[Sandbox] Access to module '${moduleName}' is not permitted`);
    }
    throw new Error(`[Sandbox] Module '${moduleName}' is not available in the plugin sandbox`);
  };
}

/**
 * Creates a sandboxed fetch function that enforces network restrictions.
 */
function createRestrictedFetch(
  allowedHosts: string[],
  maxRequests: number,
): { fetch: typeof globalThis.fetch; getRequestCount: () => number } {
  let requestCount = 0;

  const restrictedFetch: typeof globalThis.fetch = async (input, init?) => {
    if (allowedHosts.length === 0) {
      throw new Error('[Sandbox] Network access is not permitted for this plugin');
    }

    requestCount++;
    if (requestCount > maxRequests) {
      throw new Error(`[Sandbox] Network request quota exceeded (max: ${maxRequests})`);
    }

    const url =
      typeof input === 'string'
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL((input as Request).url);
    const hostname = url.hostname;

    if (!allowedHosts.includes(hostname) && !allowedHosts.includes('*')) {
      throw new Error(`[Sandbox] Network access to host '${hostname}' is not permitted`);
    }

    // Use the real fetch for allowed hosts
    return globalThis.fetch(input as string | Request, init);
  };

  return { fetch: restrictedFetch, getRequestCount: () => requestCount };
}

/**
 * Creates the sandbox global context with restricted APIs.
 */
function createSandboxGlobals(
  context: SandboxExecutionContext,
  quota: ResourceQuota,
): { globals: Record<string, unknown>; getNetworkRequestCount: () => number } {
  const restrictedRequire = createRestrictedRequire(quota.allowedNetworkHosts);
  const { fetch: restrictedFetch, getRequestCount } = createRestrictedFetch(
    quota.allowedNetworkHosts,
    quota.maxNetworkRequests,
  );

  const globals: Record<string, unknown> = {
    // Safe globals
    console: {
      log: (...args: unknown[]) => {
        /* no-op in sandbox, or could be captured */
      },
      warn: (...args: unknown[]) => {
        /* no-op */
      },
      error: (...args: unknown[]) => {
        /* no-op */
      },
      info: (...args: unknown[]) => {
        /* no-op */
      },
      debug: (...args: unknown[]) => {
        /* no-op */
      },
    },
    // Restricted require
    require: restrictedRequire,
    // Restricted fetch
    fetch: restrictedFetch,
    // Standard JS globals
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    URIError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    encodeURIComponent,
    decodeURI,
    decodeURIComponent,
    // Timer functions (limited)
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, quota.maxWallTimeMs)),
    clearTimeout,
    // Plugin context (read-only)
    __pluginContext: Object.freeze({
      tenantId: context.tenantId,
      pluginId: context.pluginId,
      installId: context.installId,
      permissions: Object.freeze([...context.grantedPermissions]),
      configuration: Object.freeze(structuredClone(context.configuration)),
      correlationId: context.correlationId,
    }),
    // Explicitly undefined dangerous globals
    process: undefined,
    global: undefined,
    globalThis: undefined,
    Buffer: undefined,
    __dirname: undefined,
    __filename: undefined,
    module: undefined,
    exports: undefined,
  };

  return { globals, getNetworkRequestCount: getRequestCount };
}

/**
 * Execute plugin code in the VM sandbox.
 */
async function executeInSandbox(message: SandboxWorkerMessage): Promise<SandboxWorkerResponse> {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;

  const { code, handler, args, context, quota } = message;
  const { globals, getNetworkRequestCount } = createSandboxGlobals(context, quota);

  try {
    // Create a VM context with the restricted globals
    const vmContext = createContext(globals, {
      name: `plugin-sandbox-${context.pluginId}`,
      codeGeneration: {
        strings: false, // Prevent eval() and new Function()
        wasm: false, // Prevent WebAssembly
      },
    });

    // Compile and run the plugin code to get the module exports
    const wrappedCode = `
      'use strict';
      const __exports = {};
      (function(exports) {
        ${code}
      })(__exports);
      __exports;
    `;

    const script = new Script(wrappedCode, {
      filename: `plugin-${context.pluginId}.js`,
    });

    const moduleExports = script.runInContext(vmContext, {
      timeout: quota.maxCpuTimeMs,
      displayErrors: true,
    }) as Record<string, unknown>;

    // Find and invoke the handler
    const handlerFn = moduleExports[handler];
    if (typeof handlerFn !== 'function') {
      throw new Error(`Handler '${handler}' is not a function or does not exist`);
    }

    // Execute the handler with a wall-time timeout
    const result = await Promise.race([
      (handlerFn as (...a: unknown[]) => unknown)(...args),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`[Sandbox] Execution exceeded wall-time limit (${quota.maxWallTimeMs}ms)`),
            ),
          quota.maxWallTimeMs,
        ),
      ),
    ]);

    const endTime = Date.now();
    const peakMemory = process.memoryUsage().heapUsed - startMemory;

    // Check memory quota
    if (peakMemory > quota.maxMemoryBytes) {
      return {
        type: 'oom',
        error: `Memory usage (${peakMemory} bytes) exceeded quota (${quota.maxMemoryBytes} bytes)`,
        durationMs: endTime - startTime,
        peakMemoryBytes: peakMemory,
        networkRequestCount: getNetworkRequestCount(),
      };
    }

    return {
      type: 'success',
      result,
      durationMs: endTime - startTime,
      peakMemoryBytes: Math.max(0, peakMemory),
      networkRequestCount: getNetworkRequestCount(),
    };
  } catch (err: unknown) {
    const endTime = Date.now();
    const peakMemory = Math.max(0, process.memoryUsage().heapUsed - startMemory);
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    // Determine error type
    if (
      errorMessage.includes('Script execution timed out') ||
      errorMessage.includes('exceeded wall-time limit')
    ) {
      return {
        type: 'timeout',
        error: errorMessage,
        stack,
        durationMs: endTime - startTime,
        peakMemoryBytes: peakMemory,
        networkRequestCount: getNetworkRequestCount(),
      };
    }

    return {
      type: 'error',
      error: errorMessage,
      stack,
      durationMs: endTime - startTime,
      peakMemoryBytes: peakMemory,
      networkRequestCount: getNetworkRequestCount(),
    };
  }
}

// ─── Worker Thread Entry Point ────────────────────────────────────────────────

if (parentPort) {
  parentPort.on('message', async (message: SandboxWorkerMessage) => {
    if (message.type === 'execute') {
      const response = await executeInSandbox(message);
      parentPort!.postMessage(response);
    }
  });
}
