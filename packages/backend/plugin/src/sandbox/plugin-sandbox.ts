/**
 * Plugin Sandbox Runtime
 *
 * Provides isolated execution for plugin code using Node.js Worker threads.
 * Key security features:
 * - Crash containment: plugin failure cannot crash the host service
 * - Resource quotas: memory, CPU time, network access limits
 * - Tenant isolation: all data access scoped to declaring tenant
 * - No filesystem access, unrestricted network, or secret access
 * - Full audit visibility for all plugin actions
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import type {
  ResourceQuota,
  SandboxExecutionContext,
  SandboxExecutionResult,
  SandboxOptions,
  SandboxAuditRecord,
  SandboxWorkerMessage,
  SandboxWorkerResponse,
} from './types.js';
import { DEFAULT_RESOURCE_QUOTA } from './types.js';

/**
 * Resolves the path to the sandbox worker script.
 */
function getWorkerPath(): string {
  // In a bundled/compiled environment, this resolves to the worker file
  // relative to this module
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    return join(currentDir, 'sandbox-worker.ts');
  } catch {
    // Fallback for CommonJS or test environments
    return join(__dirname, 'sandbox-worker.ts');
  }
}

/**
 * Plugin Sandbox - manages isolated execution of plugin code.
 *
 * Each execution spawns a Worker thread with restricted capabilities.
 * The worker is terminated after execution or on timeout/crash.
 */
export class PluginSandbox {
  private readonly quota: ResourceQuota;
  private readonly onAudit?: (record: SandboxAuditRecord) => void | Promise<void>;

  constructor(options: SandboxOptions = {}) {
    this.quota = {
      ...DEFAULT_RESOURCE_QUOTA,
      ...options.quota,
    };

    // If network is explicitly disabled, clear allowed hosts
    if (options.enableNetwork === false) {
      this.quota.allowedNetworkHosts = [];
    }

    this.onAudit = options.onAudit;
  }

  /**
   * Execute plugin code in an isolated sandbox.
   *
   * @param code - The plugin code as a string (module source)
   * @param handler - The exported function name to invoke
   * @param args - Arguments to pass to the handler
   * @param context - Execution context with tenant scoping
   * @returns Execution result with metrics
   */
  async execute<T = unknown>(
    code: string,
    handler: string,
    args: unknown[],
    context: SandboxExecutionContext,
  ): Promise<SandboxExecutionResult<T>> {
    // Validate permissions before execution
    const permissionCheck = this.validatePermissions(context);
    if (!permissionCheck.valid) {
      const auditRecord = this.createAuditRecord(
        context,
        handler,
        'permission_denied',
        0,
        0,
        0,
        permissionCheck.reason,
      );
      await this.emitAudit(auditRecord);

      return {
        success: false,
        error: {
          message: permissionCheck.reason!,
          code: 'PERMISSION_DENIED',
        },
        metrics: { durationMs: 0, peakMemoryBytes: 0, networkRequestCount: 0 },
      };
    }

    // Validate code doesn't contain obvious sandbox escape attempts
    const codeCheck = this.validateCode(code);
    if (!codeCheck.valid) {
      const auditRecord = this.createAuditRecord(
        context,
        handler,
        'error',
        0,
        0,
        0,
        codeCheck.reason,
      );
      await this.emitAudit(auditRecord);

      return {
        success: false,
        error: {
          message: codeCheck.reason!,
          code: 'EXECUTION_ERROR',
        },
        metrics: { durationMs: 0, peakMemoryBytes: 0, networkRequestCount: 0 },
      };
    }

    return this.executeInWorker<T>(code, handler, args, context);
  }

  /**
   * Execute code in a Worker thread with crash containment.
   */
  private async executeInWorker<T>(
    code: string,
    handler: string,
    args: unknown[],
    context: SandboxExecutionContext,
  ): Promise<SandboxExecutionResult<T>> {
    return new Promise<SandboxExecutionResult<T>>((resolve) => {
      let worker: Worker | null = null;
      let wallTimeTimer: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (wallTimeTimer) {
          clearTimeout(wallTimeTimer);
          wallTimeTimer = null;
        }
        if (worker) {
          try {
            worker.terminate();
          } catch {
            // Worker may already be terminated
          }
          worker = null;
        }
      };

      const resolveOnce = (result: SandboxExecutionResult<T>) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(result);
        }
      };

      try {
        const workerPath = getWorkerPath();

        worker = new Worker(workerPath, {
          // Limit worker resources
          resourceLimits: {
            maxOldGenerationSizeMb: Math.ceil(this.quota.maxMemoryBytes / (1024 * 1024)),
            maxYoungGenerationSizeMb: Math.ceil(this.quota.maxMemoryBytes / (4 * 1024 * 1024)),
            stackSizeMb: 4,
          },
          // Restrict environment variables (no secrets leak)
          env: {
            NODE_ENV: 'sandbox',
            TZ: 'UTC',
          },
          execArgv: [
            '--loader', 'ts-node/esm',
            '--no-warnings',
          ],
        });

        // Wall-time timeout (hard kill)
        wallTimeTimer = setTimeout(() => {
          const auditRecord = this.createAuditRecord(
            context,
            handler,
            'timeout',
            this.quota.maxWallTimeMs,
            0,
            0,
            `Execution exceeded wall-time limit (${this.quota.maxWallTimeMs}ms)`,
          );
          this.emitAudit(auditRecord);

          resolveOnce({
            success: false,
            error: {
              message: `Plugin execution timed out after ${this.quota.maxWallTimeMs}ms`,
              code: 'TIMEOUT',
            },
            metrics: {
              durationMs: this.quota.maxWallTimeMs,
              peakMemoryBytes: 0,
              networkRequestCount: 0,
            },
          });
        }, this.quota.maxWallTimeMs + 1000); // Extra 1s for cleanup

        // Handle worker messages (execution results)
        worker.on('message', async (response: SandboxWorkerResponse) => {
          const outcome = response.type === 'success' ? 'success' :
            response.type === 'timeout' ? 'timeout' :
            response.type === 'oom' ? 'oom' : 'error';

          const auditRecord = this.createAuditRecord(
            context,
            handler,
            outcome,
            response.durationMs,
            response.peakMemoryBytes,
            response.networkRequestCount,
            response.error,
          );
          await this.emitAudit(auditRecord);

          if (response.type === 'success') {
            resolveOnce({
              success: true,
              result: response.result as T,
              metrics: {
                durationMs: response.durationMs,
                peakMemoryBytes: response.peakMemoryBytes,
                networkRequestCount: response.networkRequestCount,
              },
            });
          } else {
            resolveOnce({
              success: false,
              error: {
                message: response.error ?? 'Unknown execution error',
                code: response.type === 'timeout' ? 'TIMEOUT' :
                  response.type === 'oom' ? 'OOM' : 'EXECUTION_ERROR',
                stack: response.stack,
              },
              metrics: {
                durationMs: response.durationMs,
                peakMemoryBytes: response.peakMemoryBytes,
                networkRequestCount: response.networkRequestCount,
              },
            });
          }
        });

        // Handle worker errors (crashes)
        worker.on('error', async (err: Error) => {
          const auditRecord = this.createAuditRecord(
            context,
            handler,
            'error',
            0,
            0,
            0,
            err.message,
          );
          await this.emitAudit(auditRecord);

          resolveOnce({
            success: false,
            error: {
              message: `Plugin crashed: ${err.message}`,
              code: 'CRASH',
              stack: err.stack,
            },
            metrics: { durationMs: 0, peakMemoryBytes: 0, networkRequestCount: 0 },
          });
        });

        // Handle worker exit (unexpected termination)
        worker.on('exit', (exitCode: number) => {
          if (exitCode !== 0 && !resolved) {
            const auditRecord = this.createAuditRecord(
              context,
              handler,
              'error',
              0,
              0,
              0,
              `Worker exited with code ${exitCode}`,
            );
            this.emitAudit(auditRecord);

            resolveOnce({
              success: false,
              error: {
                message: `Plugin worker exited unexpectedly (code: ${exitCode})`,
                code: 'CRASH',
              },
              metrics: { durationMs: 0, peakMemoryBytes: 0, networkRequestCount: 0 },
            });
          }
        });

        // Send execution message to worker
        const message: SandboxWorkerMessage = {
          type: 'execute',
          code,
          handler,
          args,
          context,
          quota: this.quota,
        };

        worker.postMessage(message);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const auditRecord = this.createAuditRecord(
          context,
          handler,
          'error',
          0,
          0,
          0,
          errorMessage,
        );
        this.emitAudit(auditRecord);

        resolveOnce({
          success: false,
          error: {
            message: `Failed to create sandbox: ${errorMessage}`,
            code: 'CRASH',
          },
          metrics: { durationMs: 0, peakMemoryBytes: 0, networkRequestCount: 0 },
        });
      }
    });
  }

  /**
   * Validate that the execution context has required permissions.
   */
  private validatePermissions(context: SandboxExecutionContext): { valid: boolean; reason?: string } {
    if (!context.tenantId) {
      return { valid: false, reason: 'Execution context must include a tenantId' };
    }
    if (!context.pluginId) {
      return { valid: false, reason: 'Execution context must include a pluginId' };
    }
    if (!context.installId) {
      return { valid: false, reason: 'Execution context must include an installId' };
    }
    return { valid: true };
  }

  /**
   * Validate plugin code for obvious sandbox escape patterns.
   * This is a defense-in-depth measure; the VM sandbox is the primary barrier.
   */
  private validateCode(code: string): { valid: boolean; reason?: string } {
    // Check for attempts to access process or require dangerous modules
    const dangerousPatterns = [
      /process\.env/g,
      /process\.exit/g,
      /child_process/g,
      /require\s*\(\s*['"]fs['"]\s*\)/g,
      /require\s*\(\s*['"]child_process['"]\s*\)/g,
      /require\s*\(\s*['"]cluster['"]\s*\)/g,
      /import\s+.*from\s+['"]fs['"]/g,
      /import\s+.*from\s+['"]child_process['"]/g,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return {
          valid: false,
          reason: `Plugin code contains blocked pattern: ${pattern.source}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Create an audit record for a sandbox execution.
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
   * Emit an audit record via the configured callback.
   */
  private async emitAudit(record: SandboxAuditRecord): Promise<void> {
    if (this.onAudit) {
      try {
        await this.onAudit(record);
      } catch {
        // Audit emission failure should not affect execution
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
