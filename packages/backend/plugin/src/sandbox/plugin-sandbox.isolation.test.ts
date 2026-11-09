/**
 * PRC-M602 — the worker/vm PluginSandbox ran plugin code in a `vm` context inside a worker
 * thread of the host process. Host objects handed to the plugin (console, fetch,
 * __pluginContext, setTimeout) exposed the host `Function` constructor, so
 * `console.log.constructor('return process')()` returned the host `process` and, from
 * there, fs, child_process and native bindings.
 *
 * These tests run the escape probes through the public PluginSandbox API and expect every
 * probe to be blocked while a benign handler still returns its value. A second group starts
 * a probe script directly under the child's Node flags (buildSandboxExecArgv) and expects the
 * permission model to deny fs / binding / child_process in the child's main realm.
 */
import { fork } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { PluginSandbox, buildSandboxExecArgv } from './plugin-sandbox.js';
import type { SandboxExecutionContext } from './types.js';

function ctx(): SandboxExecutionContext {
  return {
    tenantId: 'tenant-001',
    pluginId: 'plugin-001',
    installId: 'install-001',
    grantedPermissions: ['read:students'],
    configuration: { greeting: 'hi' },
    correlationId: 'corr-001',
  };
}

const quota = { maxWallTimeMs: 8_000, maxCpuTimeMs: 2_000 };

/** Each probe returns 'escaped:<detail>' on success or 'blocked:<error>' when denied. */
const ESCAPE_PROBES = `
  function probe(fn) {
    try { return 'escaped:' + String(fn()); }
    catch (e) { return 'blocked:' + (e && e.name ? e.name : String(e)); }
  }
  function hostFunction(obj) { return obj.constructor; }
  exports.run = function () {
    return {
      viaConsole: probe(function () { return typeof hostFunction(console.log)('return process')(); }),
      viaFetch: probe(function () { return typeof hostFunction(fetch)('return process')(); }),
      viaContext: probe(function () {
        return typeof __pluginContext.constructor.constructor('return process')();
      }),
      viaTimer: probe(function () { return typeof hostFunction(setTimeout)('return process')(); }),
      realmFunction: probe(function () { return typeof Function('return this')(); }),
      binding: probe(function () {
        var p = hostFunction(console.log)('return process')();
        return typeof p.binding('tcp_wrap');
      }),
      readPasswd: probe(function () {
        var p = hostFunction(console.log)('return process')();
        // String-split so the regex pre-filter (validateCode) is not what blocks it.
        var fsName = 'f' + 's';
        return p.mainModule.require(fsName).readFileSync('/etc/passwd', 'utf8').length;
      }),
      requireGlobal: probe(function () { return typeof require('node:net'); }),
      processGlobal: probe(function () { return typeof process.pid; }),
    };
  };
`;

describe('PRC-M602 PluginSandbox runs plugins in a restricted child process', () => {
  it('a benign handler returns its value and sees only frozen JSON context', async () => {
    const sandbox = new PluginSandbox({ quota });
    const code = `exports.h = function (a, b) {
      return { sum: a + b, tenant: __pluginContext.tenantId, frozen: Object.isFrozen(__pluginContext) };
    };`;
    const result = await sandbox.execute(code, 'h', [2, 3], ctx());
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ sum: 5, tenant: 'tenant-001', frozen: true });
  });

  it('blocks the host Function-constructor escape and every capability probe', async () => {
    const sandbox = new PluginSandbox({ quota });
    const result = await sandbox.execute<Record<string, string>>(ESCAPE_PROBES, 'run', [], ctx());
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const report = result.result!;
    for (const [probe, outcome] of Object.entries(report)) {
      expect(`${probe}=${outcome}`).toMatch(/=blocked:/);
    }
    expect(report.viaConsole).toBe('blocked:EvalError');
    expect(report.viaContext).toBe('blocked:EvalError');
    expect(report.realmFunction).toBe('blocked:EvalError');
  });

  it('does not expose host environment variables to the plugin', async () => {
    process.env.PRC_M602_CANARY = 'secret-canary';
    try {
      const sandbox = new PluginSandbox({ quota });
      const code = `exports.h = function () { return typeof globalThis.process; };`;
      const result = await sandbox.execute(code, 'h', [], ctx());
      expect(result.success).toBe(true);
      expect(result.result).toBe('undefined');
      expect(JSON.stringify(result)).not.toContain('secret-canary');
    } finally {
      delete process.env.PRC_M602_CANARY;
    }
  });

  it('kills a runaway async plugin at the wall-clock limit', async () => {
    const sandbox = new PluginSandbox({ quota: { maxWallTimeMs: 1_500, maxCpuTimeMs: 500 } });
    const code = `exports.h = function () { return new Promise(function () {}); };`;
    const result = await sandbox.execute(code, 'h', [], ctx());
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
  });

  it('stops a synchronous infinite loop at the CPU limit', async () => {
    const sandbox = new PluginSandbox({ quota: { maxWallTimeMs: 8_000, maxCpuTimeMs: 300 } });
    const result = await sandbox.execute(
      `exports.h = function () { for (;;) {} };`,
      'h',
      [],
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
  });

  it('routes fetch through the egress policy: unlisted host and metadata IP are refused', async () => {
    const sandbox = new PluginSandbox({
      quota: { ...quota, allowedNetworkHosts: ['169.254.169.254'] },
    });
    const code = `exports.h = async function () {
      const out = {};
      try { await fetch('https://evil.example.com/'); out.unlisted = 'allowed'; }
      catch (e) { out.unlisted = String(e.message); }
      try { await fetch('https://169.254.169.254/latest/meta-data/'); out.metadata = 'allowed'; }
      catch (e) { out.metadata = String(e.message); }
      return out;
    };`;
    const result = await sandbox.execute<{ unlisted: string; metadata: string }>(
      code,
      'h',
      [],
      ctx(),
    );
    expect(result.success).toBe(true);
    expect(result.result!.unlisted).toMatch(/not permitted/);
    expect(result.result!.metadata).toMatch(/SSRF|disallowed/);
    expect(result.metrics.networkRequestCount).toBe(2);
  });

  it('refuses a wildcard network allow-list at construction', () => {
    expect(() => new PluginSandbox({ quota: { allowedNetworkHosts: ['*'] } })).toThrow();
  });
});

describe('PRC-M602 defence in depth: the child main realm is denied by the permission model', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'prc-m602-')));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('fs, process.binding, child_process and string code generation are denied', async () => {
    const probe = join(dir, 'probe.mjs');
    writeFileSync(
      probe,
      `const out = {};
      const deny = (e) => (e && (e.code || e.name)) || String(e);
      try { (await import('node:fs')).readFileSync('/etc/passwd'); out.fs = 'read'; } catch (e) { out.fs = deny(e); }
      try { process.binding('tcp_wrap'); out.binding = 'ok'; } catch (e) { out.binding = deny(e); }
      try { (await import('node:child_process')).execSync('id'); out.childProcess = 'ran'; } catch (e) { out.childProcess = deny(e); }
      try { Function('return 1')(); out.codegen = 'ran'; } catch (e) { out.codegen = deny(e); }
      out.env = Object.keys(process.env).length;
      process.send(out);`,
    );
    const child = fork(probe, [], {
      execArgv: buildSandboxExecArgv(probe, 64 * 1024 * 1024),
      env: {},
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const out = await new Promise<Record<string, unknown>>((resolve, reject) => {
      child.once('message', (m) => resolve(m as Record<string, unknown>));
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`probe exited ${code}`)));
    });
    child.kill('SIGKILL');
    expect(out).toEqual({
      fs: 'ERR_ACCESS_DENIED',
      binding: 'ERR_ACCESS_DENIED',
      childProcess: 'ERR_ACCESS_DENIED',
      codegen: 'EvalError',
      env: 0,
    });
  });
});
