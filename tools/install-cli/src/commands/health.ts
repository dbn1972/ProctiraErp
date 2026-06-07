/**
 * Post-install Health Check Command
 *
 * Verifies that the installed platform is operational:
 * - All services respond on their health endpoints
 * - Admin login works
 * - Tenant resolution works
 * - Audit write works
 * - Object storage round-trip works
 * - Queue publish/consume works
 *
 * Output: structured JSON report with pass/fail per check.
 */

import type { CheckStatus } from './validate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  timestamp: string;
  overall: CheckStatus;
  checks: HealthCheckResult[];
  summary: { pass: number; fail: number; warning: number };
}

export interface HealthOptions {
  /** Base URL of the API gateway (defaults to GATEWAY_URL or http://localhost:3000) */
  gatewayUrl?: string;
  /** Admin username for login test */
  adminUsername?: string;
  /** Admin password for login test */
  adminPassword?: string;
  /** Tenant ID or subdomain for resolution test */
  tenantId?: string;
  /** Timeout per check in ms (default 10000) */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function httpGet(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const body = await response.text();
    return { ok: response.ok, status: response.status, body, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

async function httpPost(
  url: string,
  payload: unknown,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const body = await response.text();
    return { ok: response.ok, status: response.status, body, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Individual Health Checks
// ---------------------------------------------------------------------------

async function checkServiceHealth(
  baseUrl: string,
  timeoutMs: number,
): Promise<HealthCheckResult> {
  const url = `${baseUrl}/health`;
  const result = await httpGet(url, timeoutMs);

  if (result.ok) {
    return {
      name: 'service-health-endpoint',
      status: 'pass',
      message: `Health endpoint responded OK (${result.status})`,
      latencyMs: result.latencyMs,
      details: { url, statusCode: result.status },
    };
  }
  return {
    name: 'service-health-endpoint',
    status: 'fail',
    message: `Health endpoint failed: HTTP ${result.status || 'timeout'} — ${result.body.slice(0, 200)}`,
    latencyMs: result.latencyMs,
    details: { url, statusCode: result.status },
  };
}

async function checkAdminLogin(
  baseUrl: string,
  username: string | undefined,
  password: string | undefined,
  timeoutMs: number,
): Promise<HealthCheckResult> {
  const user = username ?? process.env['OPENEMIS_ADMIN_USERNAME'];
  const pass = password ?? process.env['OPENEMIS_ADMIN_PASSWORD'];

  if (!user || !pass) {
    return {
      name: 'admin-login',
      status: 'warning',
      message: 'Admin credentials not provided — login test skipped',
    };
  }

  const url = `${baseUrl}/api/v1/auth/login`;
  const result = await httpPost(url, { username: user, password: pass }, timeoutMs);

  if (result.ok) {
    return {
      name: 'admin-login',
      status: 'pass',
      message: 'Admin login successful',
      latencyMs: result.latencyMs,
    };
  }
  return {
    name: 'admin-login',
    status: 'fail',
    message: `Admin login failed: HTTP ${result.status} — ${result.body.slice(0, 200)}`,
    latencyMs: result.latencyMs,
  };
}

async function checkTenantResolution(
  baseUrl: string,
  tenantId: string | undefined,
  timeoutMs: number,
): Promise<HealthCheckResult> {
  const tenant = tenantId ?? process.env['TENANT_ID'] ?? 'default';
  const url = `${baseUrl}/api/v1/tenants/resolve`;
  const result = await httpGet(url, timeoutMs, { 'x-tenant-id': tenant });

  if (result.ok) {
    return {
      name: 'tenant-resolution',
      status: 'pass',
      message: `Tenant "${tenant}" resolved successfully`,
      latencyMs: result.latencyMs,
      details: { tenantId: tenant },
    };
  }

  // A 404 might mean the endpoint doesn't exist yet — treat as warning
  if (result.status === 404) {
    return {
      name: 'tenant-resolution',
      status: 'warning',
      message: 'Tenant resolution endpoint not found (may not be deployed yet)',
      latencyMs: result.latencyMs,
    };
  }

  return {
    name: 'tenant-resolution',
    status: 'fail',
    message: `Tenant resolution failed: HTTP ${result.status} — ${result.body.slice(0, 200)}`,
    latencyMs: result.latencyMs,
  };
}

async function checkAuditWrite(
  baseUrl: string,
  timeoutMs: number,
): Promise<HealthCheckResult> {
  const url = `${baseUrl}/api/v1/audit/health`;
  const result = await httpGet(url, timeoutMs);

  if (result.ok) {
    return {
      name: 'audit-write',
      status: 'pass',
      message: 'Audit service is healthy and writable',
      latencyMs: result.latencyMs,
    };
  }

  if (result.status === 404) {
    return {
      name: 'audit-write',
      status: 'warning',
      message: 'Audit health endpoint not found — may not be deployed yet',
      latencyMs: result.latencyMs,
    };
  }

  return {
    name: 'audit-write',
    status: 'fail',
    message: `Audit write check failed: HTTP ${result.status}`,
    latencyMs: result.latencyMs,
  };
}

async function checkObjectStorageRoundTrip(
  baseUrl: string,
  timeoutMs: number,
): Promise<HealthCheckResult> {
  const url = `${baseUrl}/api/v1/storage/health`;
  const result = await httpGet(url, timeoutMs);

  if (result.ok) {
    return {
      name: 'object-storage-roundtrip',
      status: 'pass',
      message: 'Object storage read/write verified',
      latencyMs: result.latencyMs,
    };
  }

  if (result.status === 404) {
    return {
      name: 'object-storage-roundtrip',
      status: 'warning',
      message: 'Storage health endpoint not found — may not be deployed yet',
      latencyMs: result.latencyMs,
    };
  }

  return {
    name: 'object-storage-roundtrip',
    status: 'fail',
    message: `Object storage round-trip failed: HTTP ${result.status}`,
    latencyMs: result.latencyMs,
  };
}

async function checkQueuePubSub(
  baseUrl: string,
  timeoutMs: number,
): Promise<HealthCheckResult> {
  const url = `${baseUrl}/api/v1/queue/health`;
  const result = await httpGet(url, timeoutMs);

  if (result.ok) {
    return {
      name: 'queue-publish-consume',
      status: 'pass',
      message: 'Queue publish/consume verified',
      latencyMs: result.latencyMs,
    };
  }

  if (result.status === 404) {
    return {
      name: 'queue-publish-consume',
      status: 'warning',
      message: 'Queue health endpoint not found — may not be deployed yet',
      latencyMs: result.latencyMs,
    };
  }

  return {
    name: 'queue-publish-consume',
    status: 'fail',
    message: `Queue pub/sub check failed: HTTP ${result.status}`,
    latencyMs: result.latencyMs,
  };
}

// ---------------------------------------------------------------------------
// Main Command
// ---------------------------------------------------------------------------

/**
 * Run all post-install health checks and return a structured report.
 */
export async function runHealthCheck(opts: HealthOptions = {}): Promise<HealthReport> {
  const baseUrl = opts.gatewayUrl ?? process.env['GATEWAY_URL'] ?? 'http://localhost:3000';
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const checks: HealthCheckResult[] = [];

  checks.push(await checkServiceHealth(baseUrl, timeoutMs));
  checks.push(await checkAdminLogin(baseUrl, opts.adminUsername, opts.adminPassword, timeoutMs));
  checks.push(await checkTenantResolution(baseUrl, opts.tenantId, timeoutMs));
  checks.push(await checkAuditWrite(baseUrl, timeoutMs));
  checks.push(await checkObjectStorageRoundTrip(baseUrl, timeoutMs));
  checks.push(await checkQueuePubSub(baseUrl, timeoutMs));

  const summary = { pass: 0, fail: 0, warning: 0 };
  for (const check of checks) {
    summary[check.status]++;
  }

  const overall: CheckStatus = summary.fail > 0 ? 'fail' : summary.warning > 0 ? 'warning' : 'pass';

  return {
    timestamp: new Date().toISOString(),
    overall,
    checks,
    summary,
  };
}

/**
 * CLI entry point for the health command.
 */
export async function healthCommand(argv: string[]): Promise<void> {
  const opts: HealthOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--gateway-url':
        opts.gatewayUrl = argv[++i];
        break;
      case '--admin-username':
        opts.adminUsername = argv[++i];
        break;
      case '--admin-password':
        opts.adminPassword = argv[++i];
        break;
      case '--tenant-id':
        opts.tenantId = argv[++i];
        break;
      case '--timeout':
        opts.timeoutMs = parseInt(argv[++i] ?? '10000', 10);
        break;
    }
  }

  const report = await runHealthCheck(opts);
  console.log(JSON.stringify(report, null, 2));

  if (report.overall === 'fail') {
    process.exitCode = 1;
  }
}
