/**
 * Plugin Sandbox Runtime
 *
 * PRC-M602: plugin code runs in a separate, short-lived Node.js child process, not in a
 * worker thread of the host process. A `vm` escape inside a worker reached the host
 * process's realm (same process, same fs/net/child_process access). The child is started
 * with:
 *   - `--experimental-permission --allow-fs-read=<sandbox-child.mjs>`: no fs reads beyond
 *     its own entry file, no fs writes, no child processes, no workers, no native bindings;
 *   - `--disallow-code-generation-from-strings`: `Function('…')` / `eval` throw EvalError
 *     in every realm of the child, so the host-`Function` constructor escape is closed;
 *   - `--max-old-space-size=<quota>` and an empty environment (no secrets);
 *   - a wall-clock kill (SIGKILL) enforced from this process.
 * Inside the child the plugin runs in a `vm` context with code generation disabled and no
 * `require`, `process` or `import`. Network access only goes through an IPC bridge to this
 * process, which applies the egress policy (allow-list + shared SSRF guard).
 *
 * Residual (documented, PARTIAL): Node 20's permission model has no network flag, so code
 * that escaped the vm realm into the child's main realm could still open sockets. Full
 * isolation needs isolated-vm or an OS/container sandbox.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { safeFetch } from '@proctira/common/safe-fetch';
import { v4 as uuidv4 } from 'uuid';

import { assertEgressAllowed, assertSafeAllowedHosts } from './egress-policy.js';
import type {
  ResourceQuota,
  SandboxExecutionContext,
  SandboxExecutionResult,
  SandboxOptions,
  SandboxAuditRecord,
} from './types.js';
import { DEFAULT_RESOURCE_QUOTA } from './types.js';

/** Messages exchanged with sandbox-child.mjs over IPC. */
type ChildMessage =
  | { type: 'ready' }
  | { type: 'fetch'; id: number; request: string }
  | {
      type: 'result';
      ok: boolean;
      resultJson?: string;
      error?: string;
      timeout?: boolean;
      durationMs: number;
      peakMemoryBytes: number;
    };

const MIN_HEAP_MB = 16;
/** Responses larger than this are refused by the bridge (bytes). */
const MAX_BRIDGE_RESPONSE_BYTES = 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 10_000;

/** Absolute, symlink-resolved path of the child entry (the only file it may read). */
export function resolveSandboxChildEntry(): string {
  return realpathSync(fileURLToPath(new URL('./sandbox-child.mjs', import.meta.url)));
}

/**
 * Node flags the sandbox child is started with. Exported so the defence-in-depth test can
 * start a probe script under exactly the same restrictions.
 */
export function buildSandboxExecArgv(entry: string, maxMemoryBytes: number): string[] {
  const heapMb = Math.max(MIN_HEAP_MB, Math.ceil(maxMemoryBytes / (1024 * 1024)));
  return [
    '--experimental-permission',
    `--allow-fs-read=${entry}`,
    '--disallow-code-generation-from-strings',
    `--max-old-space-size=${heapMb}`,
    '--no-warnings',
  ];
}

/**
 * Plugin Sandbox - manages isolated execution of plugin code.
 *
 * Each execution forks one restricted child process; it is killed after the result, on
 * timeout or on crash.
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
    // Fail closed on a wildcard / blank allow-list entry (same rule as InProcessSandbox).
    assertSafeAllowedHosts(this.quota.allowedNetworkHosts);

    this.onAudit = options.onAudit;
  }

  /**
   * Execute plugin code in an isolated sandbox.
   *
   * @param code - The plugin code as a string (module source)
   * @param handler - The exported function name to invoke
   * @param args - Arguments to pass to the handler (JSON-serialisable)
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

    let argsJson: string;
    let contextJson: string;
    try {
      argsJson = JSON.stringify(args ?? []);
      contextJson = JSON.stringify({
        tenantId: context.tenantId,
        pluginId: context.pluginId,
        installId: context.installId,
        permissions: [...context.grantedPermissions],
        configuration: context.configuration ?? {},
        correlationId: context.correlationId,
      });
    } catch (err) {
      const message = `Sandbox arguments must be JSON-serialisable: ${
        err instanceof Error ? err.message : String(err)
      }`;
      await this.emitAudit(this.createAuditRecord(context, handler, 'error', 0, 0, 0, message));
      return {
        success: false,
        error: { message, code: 'EXECUTION_ERROR' },
        metrics: { durationMs: 0, peakMemoryBytes: 0, networkRequestCount: 0 },
      };
    }

    return this.executeInChild<T>(code, handler, argsJson, contextJson, context);
  }

  /**
   * Execute code in a restricted child process with crash containment.
   */
  private async executeInChild<T>(
    code: string,
    handler: string,
    argsJson: string,
    contextJson: string,
    context: SandboxExecutionContext,
  ): Promise<SandboxExecutionResult<T>> {
    const startedAt = Date.now();
    let networkRequestCount = 0;

    const outcome = await new Promise<{
      result: SandboxExecutionResult<T>;
      audit: SandboxAuditRecord['outcome'];
    }>((resolve) => {
      let child: ChildProcess | null = null;
      let settled = false;
      let stderrTail = '';
      let wallTimer: ReturnType<typeof setTimeout> | null = null;

      const failure = (
        code: NonNullable<SandboxExecutionResult['error']>['code'],
        message: string,
        audit: SandboxAuditRecord['outcome'],
        extra: Partial<SandboxExecutionResult['metrics']> = {},
      ) => ({
        result: {
          success: false,
          error: { message, code },
          metrics: {
            durationMs: extra.durationMs ?? Date.now() - startedAt,
            peakMemoryBytes: extra.peakMemoryBytes ?? 0,
            networkRequestCount,
          },
        } as SandboxExecutionResult<T>,
        audit,
      });

      const settle = (value: {
        result: SandboxExecutionResult<T>;
        audit: SandboxAuditRecord['outcome'];
      }) => {
        if (settled) return;
        settled = true;
        if (wallTimer) clearTimeout(wallTimer);
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
        resolve(value);
      };

      try {
        const entry = resolveSandboxChildEntry();
        child = fork(entry, [], {
          execArgv: buildSandboxExecArgv(entry, this.quota.maxMemoryBytes),
          // Empty environment: no secrets, no NODE_OPTIONS inherited from the host.
          env: {},
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          serialization: 'json',
        });
      } catch (err) {
        settle(
          failure(
            'CRASH',
            `Failed to create sandbox: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          ),
        );
        return;
      }

      const proc = child;
      proc.stdout?.resume();
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4096);
      });

      wallTimer = setTimeout(() => {
        settle(
          failure(
            'TIMEOUT',
            `Plugin execution timed out after ${this.quota.maxWallTimeMs}ms`,
            'timeout',
            { durationMs: this.quota.maxWallTimeMs },
          ),
        );
      }, this.quota.maxWallTimeMs);

      proc.on('message', (raw: unknown) => {
        const message = raw as ChildMessage;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') {
          proc.send({
            type: 'execute',
            code,
            handler,
            argsJson,
            contextJson,
            maxCpuTimeMs: this.quota.maxCpuTimeMs,
            maxTimerMs: this.quota.maxWallTimeMs,
          });
          return;
        }
        if (message.type === 'fetch') {
          networkRequestCount += 1;
          void this.bridgeFetch(message.request, networkRequestCount).then(
            (responseJson) => {
              if (!settled && proc.connected) {
                proc.send({ type: 'fetch-result', id: message.id, responseJson });
              }
            },
            (err: unknown) => {
              if (!settled && proc.connected) {
                proc.send({
                  type: 'fetch-result',
                  id: message.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            },
          );
          return;
        }
        if (message.type === 'result') {
          const metrics = {
            durationMs: message.durationMs,
            peakMemoryBytes: message.peakMemoryBytes,
          };
          if (message.ok) {
            let parsed: unknown = null;
            try {
              parsed = message.resultJson === undefined ? null : JSON.parse(message.resultJson);
            } catch {
              settle(
                failure('EXECUTION_ERROR', 'Plugin returned an unserialisable result', 'error'),
              );
              return;
            }
            const peak = metrics.peakMemoryBytes;
            if (peak > this.quota.maxMemoryBytes) {
              settle(
                failure(
                  'OOM',
                  `Memory usage (${peak} bytes) exceeded quota (${this.quota.maxMemoryBytes} bytes)`,
                  'oom',
                  metrics,
                ),
              );
              return;
            }
            settle({
              result: {
                success: true,
                result: parsed as T,
                metrics: { ...metrics, networkRequestCount },
              },
              audit: 'success',
            });
            return;
          }
          settle(
            failure(
              message.timeout ? 'TIMEOUT' : 'EXECUTION_ERROR',
              message.error ?? 'Unknown execution error',
              message.timeout ? 'timeout' : 'error',
              metrics,
            ),
          );
        }
      });

      proc.on('error', (err: Error) => {
        settle(failure('CRASH', `Plugin crashed: ${err.message}`, 'error'));
      });

      proc.on('exit', (exitCode: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        const oom = /heap out of memory|Allocation failed/i.test(stderrTail);
        settle(
          oom
            ? failure('OOM', 'Plugin exceeded its memory quota', 'oom')
            : failure(
                'CRASH',
                `Plugin sandbox exited unexpectedly (code: ${exitCode ?? 'null'}, signal: ${signal ?? 'none'})`,
                'error',
              ),
        );
      });
    });

    const { result } = outcome;
    await this.emitAudit(
      this.createAuditRecord(
        context,
        handler,
        outcome.audit,
        result.metrics.durationMs,
        result.metrics.peakMemoryBytes,
        result.metrics.networkRequestCount,
        result.error?.message,
      ),
    );
    return result;
  }

  /**
   * Network bridge: the only way plugin code reaches the network. Enforces the request
   * quota, the explicit allow-list and the shared SSRF guard, and never follows redirects
   * (a redirect could leave the allow-list).
   */
  private async bridgeFetch(requestJson: string, requestNumber: number): Promise<string> {
    if (requestNumber > this.quota.maxNetworkRequests) {
      throw new Error(
        `[Sandbox] Network request quota exceeded (max: ${this.quota.maxNetworkRequests})`,
      );
    }
    let request: { url: string; method?: string; headers?: unknown; body?: string };
    try {
      request = JSON.parse(requestJson) as typeof request;
    } catch {
      throw new Error('[Sandbox] Malformed network request');
    }
    if (typeof request.url !== 'string') throw new Error('[Sandbox] Malformed network request');
    await assertEgressAllowed(request.url, this.quota.allowedNetworkHosts);

    const headers: Record<string, string> = {};
    if (request.headers && typeof request.headers === 'object') {
      for (const [key, value] of Object.entries(request.headers as Record<string, unknown>)) {
        headers[key] = String(value);
      }
    }
    const response = await safeFetch(request.url, {
      method: typeof request.method === 'string' ? request.method : 'GET',
      headers,
      body: typeof request.body === 'string' ? request.body : undefined,
      maxRedirects: 0,
      timeoutMs: Math.min(BRIDGE_TIMEOUT_MS, this.quota.maxWallTimeMs),
      maxResponseBytes: MAX_BRIDGE_RESPONSE_BYTES,
    });
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    return JSON.stringify({
      status: response.status,
      headers: responseHeaders,
      body: await response.text(),
    });
  }

  /**
   * Validate that the execution context has required permissions.
   */
  private validatePermissions(context: SandboxExecutionContext): {
    valid: boolean;
    reason?: string;
  } {
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
   * This is a defense-in-depth measure; the process boundary is the primary barrier.
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
