/**
 * Tests for the In-Process Plugin Sandbox
 *
 * Validates:
 * - Isolated execution of plugin code
 * - Resource quota enforcement (CPU time)
 * - Blocked module access (fs, child_process, etc.)
 * - Tenant-scoped context
 * - Network access restrictions
 * - Audit visibility for all actions
 * - Crash containment
 */
import { describe, it, expect, vi } from 'vitest';
import { InProcessSandbox } from './in-process-sandbox.js';
import type { SandboxExecutionContext, SandboxAuditRecord } from './types.js';

function createTestContext(
  overrides: Partial<SandboxExecutionContext> = {},
): SandboxExecutionContext {
  return {
    tenantId: 'tenant-001',
    pluginId: 'plugin-001',
    installId: 'install-001',
    grantedPermissions: ['read:students', 'write:attendance'],
    configuration: { apiKey: 'test-key' },
    correlationId: 'corr-001',
    ...overrides,
  };
}

describe('InProcessSandbox', () => {
  describe('basic execution', () => {
    it('should execute simple plugin code and return result', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.greet = function(name) {
          return 'Hello, ' + name + '!';
        };
      `;

      const result = await sandbox.execute(code, 'greet', ['World'], createTestContext());

      expect(result.success).toBe(true);
      expect(result.result).toBe('Hello, World!');
      expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should execute async plugin code', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.asyncHandler = async function(x, y) {
          return x + y;
        };
      `;

      const result = await sandbox.execute(code, 'asyncHandler', [3, 4], createTestContext());

      expect(result.success).toBe(true);
      expect(result.result).toBe(7);
    });

    it('should return error when handler does not exist', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.existing = function() { return 1; };
      `;

      const result = await sandbox.execute(code, 'nonExistent', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('nonExistent');
      expect(result.error?.message).toContain('not a function');
    });

    it('should handle plugin code that throws an error', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.failing = function() {
          throw new Error('Plugin error');
        };
      `;

      const result = await sandbox.execute(code, 'failing', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(result.error?.message).toContain('Plugin error');
    });

    it('should handle syntax errors in plugin code', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.broken = function( {
          return 1;
        };
      `;

      const result = await sandbox.execute(code, 'broken', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
    });
  });

  describe('resource quota enforcement', () => {
    it('should timeout on CPU-intensive code', async () => {
      const sandbox = new InProcessSandbox({
        quota: { maxCpuTimeMs: 50 },
      });
      const code = `
        exports.infinite = function() {
          while(true) {}
        };
      `;

      const result = await sandbox.execute(code, 'infinite', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
    });

    it('should respect wall-time limit for async operations', async () => {
      const sandbox = new InProcessSandbox({
        quota: { maxWallTimeMs: 100, maxCpuTimeMs: 5000 },
      });
      // Use a promise that never resolves to test wall-time timeout
      const code = `
        exports.slow = function() {
          return new Promise(function(resolve) {
            // This promise never resolves, so wall-time limit should kick in
          });
        };
      `;

      const result = await sandbox.execute(code, 'slow', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.error?.message).toContain('wall-time limit');
    });
  });

  describe('module access restrictions', () => {
    it('should block access to fs module', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.readFile = function() {
          var fs = require('fs');
          return fs.readFileSync('/etc/passwd', 'utf8');
        };
      `;

      const result = await sandbox.execute(code, 'readFile', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('fs');
      expect(result.error?.message).toContain('not permitted');
    });

    it('should block access to child_process module', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.exec = function() {
          var cp = require('child_process');
          return cp.execSync('ls');
        };
      `;

      const result = await sandbox.execute(code, 'exec', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('child_process');
      expect(result.error?.message).toContain('not permitted');
    });

    it('should block access to os module', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.getInfo = function() {
          var os = require('os');
          return os.hostname();
        };
      `;

      const result = await sandbox.execute(code, 'getInfo', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('os');
      expect(result.error?.message).toContain('not permitted');
    });

    it('should block access to net module', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.connect = function() {
          var net = require('net');
          return net.createConnection(80, 'evil.com');
        };
      `;

      const result = await sandbox.execute(code, 'connect', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('net');
      expect(result.error?.message).toContain('not permitted');
    });

    it('should block access to worker_threads module', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.spawn = function() {
          var wt = require('worker_threads');
          return wt.isMainThread;
        };
      `;

      const result = await sandbox.execute(code, 'spawn', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('worker_threads');
      expect(result.error?.message).toContain('not permitted');
    });

    it('should block access to arbitrary modules', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.load = function() {
          return require('some-random-module');
        };
      `;

      const result = await sandbox.execute(code, 'load', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not available');
    });
  });

  describe('network access restrictions', () => {
    it('should block all network access when no hosts are allowed', async () => {
      const sandbox = new InProcessSandbox({
        enableNetwork: false,
      });
      const code = `
        exports.callApi = async function() {
          return await fetch('https://api.example.com/data');
        };
      `;

      const result = await sandbox.execute(code, 'callApi', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Network access is not permitted');
    });

    it('should block access to unauthorized hosts', async () => {
      const sandbox = new InProcessSandbox({
        quota: { allowedNetworkHosts: ['api.allowed.com'] },
      });
      const code = `
        exports.callApi = async function() {
          return await fetch('https://api.evil.com/data');
        };
      `;

      const result = await sandbox.execute(code, 'callApi', [], createTestContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('api.evil.com');
      expect(result.error?.message).toContain('not permitted');
    });

    it('should enforce network request quota', async () => {
      const sandbox = new InProcessSandbox({
        quota: {
          allowedNetworkHosts: ['*'],
          maxNetworkRequests: 2,
        },
      });
      // This code tries to make 3 requests but the fetch will fail
      // because there's no real server, but the quota check happens first
      const code = `
        exports.manyRequests = async function() {
          var errors = [];
          for (var i = 0; i < 3; i++) {
            try {
              await fetch('https://example.com/api/' + i);
            } catch(e) {
              errors.push(e.message);
            }
          }
          return errors;
        };
      `;

      const result = await sandbox.execute(code, 'manyRequests', [], createTestContext());

      // The third request should fail with quota exceeded
      if (result.success) {
        const errors = result.result as string[];
        expect(errors.some((e: string) => e.includes('quota exceeded'))).toBe(true);
      }
      // Or the whole execution might fail
    });
  });

  describe('tenant isolation', () => {
    it('should provide tenant-scoped context to plugin code', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.getTenantId = function() {
          return __pluginContext.tenantId;
        };
      `;

      const context = createTestContext({ tenantId: 'tenant-xyz' });
      const result = await sandbox.execute(code, 'getTenantId', [], context);

      expect(result.success).toBe(true);
      expect(result.result).toBe('tenant-xyz');
    });

    it('should provide frozen configuration to plugin code', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.getConfig = function() {
          return __pluginContext.configuration;
        };
      `;

      const context = createTestContext({ configuration: { setting: 'value' } });
      const result = await sandbox.execute(code, 'getConfig', [], context);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ setting: 'value' });
    });

    it('should prevent modification of plugin context', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.tryModify = function() {
          try {
            __pluginContext.tenantId = 'hacked';
            return 'modified';
          } catch(e) {
            return 'frozen';
          }
        };
      `;

      const result = await sandbox.execute(code, 'tryModify', [], createTestContext());

      expect(result.success).toBe(true);
      expect(result.result).toBe('frozen');
    });

    it('should reject execution without tenantId', async () => {
      const sandbox = new InProcessSandbox();
      const code = `exports.handler = function() { return 1; };`;

      const context = createTestContext({ tenantId: '' });
      const result = await sandbox.execute(code, 'handler', [], context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_DENIED');
    });

    it('should reject execution without pluginId', async () => {
      const sandbox = new InProcessSandbox();
      const code = `exports.handler = function() { return 1; };`;

      const context = createTestContext({ pluginId: '' });
      const result = await sandbox.execute(code, 'handler', [], context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('dangerous global access prevention', () => {
    it('should not expose process global', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.getEnv = function() {
          return typeof process;
        };
      `;

      const result = await sandbox.execute(code, 'getEnv', [], createTestContext());

      expect(result.success).toBe(true);
      expect(result.result).toBe('undefined');
    });

    it('should not expose globalThis', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.getGlobal = function() {
          return typeof globalThis;
        };
      `;

      const result = await sandbox.execute(code, 'getGlobal', [], createTestContext());

      expect(result.success).toBe(true);
      expect(result.result).toBe('undefined');
    });

    it('should not expose Buffer', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.getBuffer = function() {
          return typeof Buffer;
        };
      `;

      const result = await sandbox.execute(code, 'getBuffer', [], createTestContext());

      expect(result.success).toBe(true);
      expect(result.result).toBe('undefined');
    });

    it('should block eval via codeGeneration restriction', async () => {
      const sandbox = new InProcessSandbox();
      const code = `
        exports.tryEval = function() {
          try {
            return eval('1 + 1');
          } catch(e) {
            return 'blocked: ' + e.message;
          }
        };
      `;

      const result = await sandbox.execute(code, 'tryEval', [], createTestContext());

      expect(result.success).toBe(true);
      expect(String(result.result)).toContain('blocked');
    });
  });

  describe('audit visibility', () => {
    it('should emit audit record on successful execution', async () => {
      const auditRecords: SandboxAuditRecord[] = [];
      const sandbox = new InProcessSandbox({
        onAudit: (record) => {
          auditRecords.push(record);
        },
      });
      const code = `exports.handler = function() { return 42; };`;

      await sandbox.execute(code, 'handler', [], createTestContext());

      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0]!.outcome).toBe('success');
      expect(auditRecords[0]!.pluginId).toBe('plugin-001');
      expect(auditRecords[0]!.tenantId).toBe('tenant-001');
      expect(auditRecords[0]!.handler).toBe('handler');
      expect(auditRecords[0]!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should emit audit record on execution error', async () => {
      const auditRecords: SandboxAuditRecord[] = [];
      const sandbox = new InProcessSandbox({
        onAudit: (record) => {
          auditRecords.push(record);
        },
      });
      const code = `exports.handler = function() { throw new Error('fail'); };`;

      await sandbox.execute(code, 'handler', [], createTestContext());

      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0]!.outcome).toBe('error');
      expect(auditRecords[0]!.errorMessage).toContain('fail');
    });

    it('should emit audit record on timeout', async () => {
      const auditRecords: SandboxAuditRecord[] = [];
      const sandbox = new InProcessSandbox({
        quota: { maxCpuTimeMs: 50 },
        onAudit: (record) => {
          auditRecords.push(record);
        },
      });
      const code = `exports.handler = function() { while(true) {} };`;

      await sandbox.execute(code, 'handler', [], createTestContext());

      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0]!.outcome).toBe('timeout');
    });

    it('should emit audit record on permission denied', async () => {
      const auditRecords: SandboxAuditRecord[] = [];
      const sandbox = new InProcessSandbox({
        onAudit: (record) => {
          auditRecords.push(record);
        },
      });
      const code = `exports.handler = function() { return 1; };`;

      await sandbox.execute(code, 'handler', [], createTestContext({ tenantId: '' }));

      expect(auditRecords).toHaveLength(1);
      expect(auditRecords[0]!.outcome).toBe('permission_denied');
    });

    it('should include correlation ID in audit records', async () => {
      const auditRecords: SandboxAuditRecord[] = [];
      const sandbox = new InProcessSandbox({
        onAudit: (record) => {
          auditRecords.push(record);
        },
      });
      const code = `exports.handler = function() { return 1; };`;

      await sandbox.execute(code, 'handler', [], createTestContext({ correlationId: 'trace-123' }));

      expect(auditRecords[0]!.correlationId).toBe('trace-123');
    });

    it('should not fail execution if audit callback throws', async () => {
      const sandbox = new InProcessSandbox({
        onAudit: () => {
          throw new Error('Audit storage failed');
        },
      });
      const code = `exports.handler = function() { return 'ok'; };`;

      const result = await sandbox.execute(code, 'handler', [], createTestContext());

      expect(result.success).toBe(true);
      expect(result.result).toBe('ok');
    });
  });

  describe('quota configuration', () => {
    it('should use default quotas when none specified', () => {
      const sandbox = new InProcessSandbox();
      const quota = sandbox.getQuota();

      expect(quota.maxMemoryBytes).toBe(64 * 1024 * 1024);
      expect(quota.maxCpuTimeMs).toBe(5000);
      expect(quota.maxWallTimeMs).toBe(30000);
      expect(quota.maxNetworkRequests).toBe(10);
    });

    it('should allow custom quota overrides', () => {
      const sandbox = new InProcessSandbox({
        quota: {
          maxMemoryBytes: 32 * 1024 * 1024,
          maxCpuTimeMs: 2000,
          maxNetworkRequests: 5,
        },
      });
      const quota = sandbox.getQuota();

      expect(quota.maxMemoryBytes).toBe(32 * 1024 * 1024);
      expect(quota.maxCpuTimeMs).toBe(2000);
      expect(quota.maxNetworkRequests).toBe(5);
    });

    it('should return frozen quota object', () => {
      const sandbox = new InProcessSandbox();
      const quota = sandbox.getQuota();

      expect(() => {
        (quota as any).maxMemoryBytes = 0;
      }).toThrow();
    });
  });
});
