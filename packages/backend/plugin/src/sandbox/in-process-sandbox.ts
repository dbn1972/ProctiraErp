/**
 * In-Process Plugin Sandbox
 *
 * A lighter-weight sandbox implementation that uses Node.js `vm` module
 * directly (without worker threads). This provides:
 * - Code isolation via VM contexts
 * - Blocked module access
 * - Tenant-scoped execution context
 * - Audit logging
 *
 * Trade-offs vs Worker-based sandbox:
 * - Faster startup (no thread creation overhead)
 * - Less crash containment (infinite loops can block the event loop)
 * - Suitable for short-lived, trusted plugin code
 *
 * For production use with untrusted code, prefer PluginSandbox (worker-based).
 */
import { createContext, Script } from 'node:vm';
import { v4 as uuidv4 } from 'uuid';

import type {
  ResourceQuota,
  SandboxExecutionContext,
  SandboxExecutionResult,
  SandboxOptions,
  SandboxAuditRecord,
} from './types.js';
import { DEFAULT_RESOURCE_QUOTA } from './types.js';

/**
 * In-Process Sandbox - executes plugin code in a VM context
 * within the same process. Provides isolation without worker overhead.
 */
export class InProcessSandbox {
  private readonly quota: ResourceQuota;
  private readonly onAudit?: (record: SandboxAuditRecord) => void | Promise<void>;

  constructor(options: SandboxOptions = {}) {
    this.quota = {
      ...DEFAULT_RESOURCE_QUOTA,
      ...options.quota,
    };

    if (options.enableNetwork === false) {
      this.quota.allowedNetworkHosts = [];
    }

    this.onAudit = options.onAudit;
  }

  /**
   * Execute plugin code in a VM sandbox within the current process.
   */
  async execute<T = unknown>(
    code: string,
    handler: string,
    args: unknown[],
    context: SandboxExecutionContext,
  ): Promise<SandboxExecutionResult<T>> {
    // Validate context
    if (!context.tenantId || !context.pluginId || !context.installId) {
      const auditRecord = this.createAuditRecord(
        context,
        handler,
        'permission_denied',
        0,
        0,
        0,
        'Missing required context fields (tenantId, pluginId, installId)',
      );
      await this.emitAudit(auditRecord);

      return {
        success: false,
        error: {
          message: 'Missing required context fields (tenantId, pluginId, installId)',
          code: 'PERMISSION_DENIED',
        },
        metrics: { durationMs: 0, peakMemoryBytes: 0, networkRequestCount: 0 },
      };
    }

    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    let networkRequestCount = 0;

    try {
      // Create restricted globals
      const globals = this.createSandboxGlobals(context, () => {
        networkRequestCount++;
        return networkRequestCount;
      });

      // Create VM context
      const vmContext = createContext(globals, {
        name: `plugin-sandbox-${context.pluginId}`,
        codeGeneration: {
          strings: false, // Block eval() and new Function()
          wasm: false,
        },
      });

      // Wrap code in a module pattern that also invokes the handler
      // This ensures the timeout applies to both module evaluation AND handler execution
      const wrappedCode = `
        'use strict';
        const __exports = {};
        (function(exports) {
          ${code}
        })(__exports);
        __exports;
      `;

      // Compile and execute module definition (with CPU timeout)
      const script = new Script(wrappedCode, {
        filename: `plugin-${context.pluginId}.js`,
      });

      const moduleExports = script.runInContext(vmContext, {
        timeout: this.quota.maxCpuTimeMs,
        displayErrors: true,
      }) as Record<string, unknown>;

      // Find handler
      const handlerFn = moduleExports[handler];
      if (typeof handlerFn !== 'function') {
        throw new Error(`Handler '${handler}' is not a function or does not exist`);
      }

      // Execute the handler inside a VM script with timeout to catch synchronous infinite loops.
      // We store the handler in the context and invoke it via a new script.
      (vmContext as Record<string, unknown>).__handler = handlerFn;
      (vmContext as Record<string, unknown>).__args = args;

      const invokeScript = new Script(`__handler.apply(null, __args);`, {
        filename: `plugin-${context.pluginId}-invoke.js`,
      });

      const handlerResult = invokeScript.runInContext(vmContext, {
        timeout: this.quota.maxCpuTimeMs,
        displayErrors: true,
      });

      let result: unknown;
      if (handlerResult && typeof (handlerResult as Promise<unknown>).then === 'function') {
        // Async handler - use wall-time timeout
        result = await Promise.race([
          handlerResult,
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(`Execution exceeded wall-time limit (${this.quota.maxWallTimeMs}ms)`),
                ),
              this.quota.maxWallTimeMs,
            ),
          ),
        ]);
      } else {
        result = handlerResult;
      }

      const durationMs = Date.now() - startTime;
      const peakMemoryBytes = Math.max(0, process.memoryUsage().heapUsed - startMemory);

      // Check memory quota
      if (peakMemoryBytes > this.quota.maxMemoryBytes) {
        const auditRecord = this.createAuditRecord(
          context,
          handler,
          'oom',
          durationMs,
          peakMemoryBytes,
          networkRequestCount,
          `Memory usage exceeded quota`,
        );
        await this.emitAudit(auditRecord);

        return {
          success: false,
          error: {
            message: `Memory usage exceeded quota (${this.quota.maxMemoryBytes} bytes)`,
            code: 'OOM',
          },
          metrics: { durationMs, peakMemoryBytes, networkRequestCount },
        };
      }

      const auditRecord = this.createAuditRecord(
        context,
        handler,
        'success',
        durationMs,
        peakMemoryBytes,
        networkRequestCount,
      );
      await this.emitAudit(auditRecord);

      return {
        success: true,
        result: result as T,
        metrics: { durationMs, peakMemoryBytes, networkRequestCount },
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const peakMemoryBytes = Math.max(0, process.memoryUsage().heapUsed - startMemory);
      const errorMessage = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;

      const isTimeout =
        errorMessage.includes('Script execution timed out') ||
        errorMessage.includes('exceeded wall-time limit');

      const outcome: SandboxAuditRecord['outcome'] = isTimeout ? 'timeout' : 'error';
      const errorCode = isTimeout ? ('TIMEOUT' as const) : ('EXECUTION_ERROR' as const);

      const auditRecord = this.createAuditRecord(
        context,
        handler,
        outcome,
        durationMs,
        peakMemoryBytes,
        networkRequestCount,
        errorMessage,
      );
      await this.emitAudit(auditRecord);

      return {
        success: false,
        error: {
          message: errorMessage,
          code: errorCode,
          stack,
        },
        metrics: { durationMs, peakMemoryBytes, networkRequestCount },
      };
    }
  }

  /**
   * Create restricted globals for the VM context.
   */
  private createSandboxGlobals(
    context: SandboxExecutionContext,
    incrementNetworkCount: () => number,
  ): Record<string, unknown> {
    const quota = this.quota;

    // Restricted require
    const blockedModules = new Set([
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

    const restrictedRequire = (moduleName: string): never => {
      if (blockedModules.has(moduleName)) {
        throw new Error(`[Sandbox] Access to module '${moduleName}' is not permitted`);
      }
      throw new Error(`[Sandbox] Module '${moduleName}' is not available in the plugin sandbox`);
    };

    // Restricted fetch
    const restrictedFetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      if (quota.allowedNetworkHosts.length === 0) {
        throw new Error('[Sandbox] Network access is not permitted for this plugin');
      }

      const count = incrementNetworkCount();
      if (count > quota.maxNetworkRequests) {
        throw new Error(
          `[Sandbox] Network request quota exceeded (max: ${quota.maxNetworkRequests})`,
        );
      }

      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const url = new URL(urlStr);

      if (
        !quota.allowedNetworkHosts.includes(url.hostname) &&
        !quota.allowedNetworkHosts.includes('*')
      ) {
        throw new Error(`[Sandbox] Network access to host '${url.hostname}' is not permitted`);
      }

      return globalThis.fetch(input as string | Request, init);
    };

    return {
      // Safe console (no-op)
      console: Object.freeze({
        log: () => {},
        warn: () => {},
        error: () => {},
        info: () => {},
        debug: () => {},
      }),
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
      // Timer (limited)
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, quota.maxWallTimeMs)),
      clearTimeout,
      // Plugin context (frozen/read-only)
      __pluginContext: Object.freeze({
        tenantId: context.tenantId,
        pluginId: context.pluginId,
        installId: context.installId,
        permissions: Object.freeze([...context.grantedPermissions]),
        configuration: Object.freeze(structuredClone(context.configuration)),
        correlationId: context.correlationId,
      }),
      // Explicitly blocked dangerous globals
      process: undefined,
      global: undefined,
      globalThis: undefined,
      Buffer: undefined,
      __dirname: undefined,
      __filename: undefined,
      module: undefined,
      exports: undefined,
    };
  }

  /**
   * Create an audit record.
   */
  private createAuditRecord(
    context: SandboxExecutionContext,
    handler: string,
    outcome: SandboxAuditRecord['outcome'],
    durationMs: number,
    peakMemoryBytes: number,
    networkRequestCount: number,
    errorMessage?: string,
  ): SandboxAuditRecord {
    return {
      id: uuidv4(),
      pluginId: context.pluginId,
      tenantId: context.tenantId,
      installId: context.installId,
      correlationId: context.correlationId,
      handler,
      outcome,
      durationMs,
      peakMemoryBytes,
      networkRequestCount,
      errorMessage,
      timestamp: new Date(),
    };
  }

  /**
   * Emit an audit record.
   */
  private async emitAudit(record: SandboxAuditRecord): Promise<void> {
    if (this.onAudit) {
      try {
        await this.onAudit(record);
      } catch {
        // Audit failure should not affect execution
      }
    }
  }

  /**
   * Get the current resource quota configuration.
   */
  getQuota(): Readonly<ResourceQuota> {
    return Object.freeze({ ...this.quota });
  }
}
