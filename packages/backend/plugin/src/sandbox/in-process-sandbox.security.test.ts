/**
 * NEW-g7_platform-011 — plugin sandbox security hardening.
 *
 * Proves the fail-closed defaults:
 *  - the node:vm InProcessSandbox refuses to run code unless the caller explicitly opts in;
 *  - a '*' (or empty) egress allow-list is rejected at construction;
 *  - the egress policy blocks private/metadata/loopback hosts (SSRF) and non-https.
 *
 * These tests FAIL without the fix: before, InProcessSandbox executed any code and the allow-list
 * matched '*' / hostname-only with no SSRF/metadata blocking.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SandboxEgressError,
  assertEgressAllowed,
  assertSafeAllowedHosts,
} from './egress-policy.js';
import { InProcessSandbox } from './in-process-sandbox.js';
import type { SandboxExecutionContext } from './types.js';

function ctx(): SandboxExecutionContext {
  return {
    tenantId: 'tenant-001',
    pluginId: 'plugin-001',
    installId: 'install-001',
    grantedPermissions: [],
    configuration: {},
    correlationId: 'corr-001',
  };
}

describe('NEW-g7_platform-011 in-process sandbox refuses untrusted code by default', () => {
  it('returns PERMISSION_DENIED without executing when not explicitly trusted', async () => {
    const sandbox = new InProcessSandbox();
    const code = `exports.h = function(){ return 'ran'; };`;
    const result = await sandbox.execute(code, 'h', [], ctx());
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PERMISSION_DENIED');
    expect(result.result).toBeUndefined();
  });

  it('executes only when allowUntrustedInProcess is explicitly set', async () => {
    const sandbox = new InProcessSandbox({ allowUntrustedInProcess: true });
    const code = `exports.h = function(){ return 'ran'; };`;
    const result = await sandbox.execute(code, 'h', [], ctx());
    expect(result.success).toBe(true);
    expect(result.result).toBe('ran');
  });
});

describe('NEW-g7_platform-011 egress allow-list is fail-closed', () => {
  it('rejects a wildcard allow-list at construction', () => {
    expect(() => new InProcessSandbox({ quota: { allowedNetworkHosts: ['*'] } })).toThrow(
      SandboxEgressError,
    );
  });

  it('assertSafeAllowedHosts rejects "*" and empty host', () => {
    expect(() => assertSafeAllowedHosts(['*'])).toThrow(SandboxEgressError);
    expect(() => assertSafeAllowedHosts([''])).toThrow(SandboxEgressError);
    expect(() => assertSafeAllowedHosts(['api.example.com'])).not.toThrow();
  });

  it('blocks the metadata IP and loopback even if listed', async () => {
    await expect(
      assertEgressAllowed('https://169.254.169.254/latest/meta-data/', ['169.254.169.254']),
    ).rejects.toBeInstanceOf(SandboxEgressError);
    await expect(assertEgressAllowed('https://127.0.0.1/', ['127.0.0.1'])).rejects.toBeInstanceOf(
      SandboxEgressError,
    );
  });

  it('blocks non-https and hosts not on the allow-list', async () => {
    await expect(
      assertEgressAllowed('http://api.example.com/', ['api.example.com']),
    ).rejects.toBeInstanceOf(SandboxEgressError);
    await expect(
      assertEgressAllowed('https://evil.example.com/', ['api.example.com']),
    ).rejects.toBeInstanceOf(SandboxEgressError);
  });
});

describe('PRC-M628 in-process sandbox never follows egress redirects', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the 3xx to the plugin instead of following it to a metadata host', async () => {
    // Stand-in for undici: follows the Location unless redirect is 'manual' or 'error',
    // exactly like the real fetch default ('follow').
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_input: unknown, init?: RequestInit) => {
        if (init?.redirect === 'manual' || init?.redirect === 'error') {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: 'http://169.254.169.254/latest/meta-data/' },
            }),
          );
        }
        return Promise.resolve(new Response('metadata-secret', { status: 200 }));
      });
    const sandbox = new InProcessSandbox({
      allowUntrustedInProcess: true,
      quota: { allowedNetworkHosts: ['93.184.215.14'] },
    });
    const code = `exports.h = async function(){
      var r = await fetch('https://93.184.215.14/start', { redirect: 'follow' });
      return { status: r.status, body: await r.text() };
    };`;
    const result = await sandbox.execute(code, 'h', [], ctx());
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ status: 302, body: '' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });
});
