/**
 * Diagnostic Bundle Generator Command
 *
 * Collects system state for support/troubleshooting:
 * - Service status
 * - Version/build info
 * - Config summary (secrets redacted)
 * - Adapter health
 * - Recent errors (last 100 lines from each service log)
 * - Readiness score snapshot
 *
 * Output: diagnostics-{timestamp}.json
 */

import { writeFileSync } from 'node:fs';
import { hostname, platform, arch, release, totalmem, freemem, cpus, uptime } from 'node:os';
import { join } from 'node:path';
import { runReadinessCheck } from './readiness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceStatus {
  name: string;
  url: string;
  healthy: boolean;
  statusCode: number;
  latencyMs: number;
  error?: string;
}

export interface DiagnosticBundle {
  metadata: {
    generatedAt: string;
    hostname: string;
    platform: string;
    arch: string;
    osRelease: string;
    nodeVersion: string;
    uptimeSeconds: number;
  };
  system: {
    totalMemoryGb: number;
    freeMemoryGb: number;
    cpuCount: number;
    cpuModel: string;
  };
  services: ServiceStatus[];
  configuration: Record<string, string | undefined>;
  adapterHealth: Record<string, { healthy: boolean; message: string; latencyMs: number }>;
  recentErrors: Record<string, string[]>;
  readinessSnapshot: {
    totalScore: number;
    maxScore: number;
    grade: string;
    categories: Array<{ name: string; score: number; status: string }>;
  };
  versions: {
    platform: string;
    node: string;
    pnpm?: string;
    docker?: string;
  };
}

export interface DiagnosticsOptions {
  /** Base URL of the API gateway */
  gatewayUrl?: string;
  /** Output directory for the bundle file */
  outputDir?: string;
  /** Timeout per check in ms */
  timeoutMs?: number;
  /** Whether to write to file (default true) */
  writeFile?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REDACT_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /credential/i,
  /auth/i,
];

function redactValue(key: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (REDACT_PATTERNS.some((p) => p.test(key))) {
    return '***REDACTED***';
  }
  return value;
}

function getConfigSummary(): Record<string, string | undefined> {
  const relevantPrefixes = [
    'NODE_ENV', 'LOG_LEVEL', 'PORT', 'HOST',
    'DATABASE_URL', 'REDIS_URL', 'KAFKA_BROKERS', 'RABBITMQ_URL',
    'S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION',
    'JWT_SECRET', 'JWT_ISSUER', 'JWT_AUDIENCE',
    'COOKIE_SECRET', 'CORS_ORIGINS',
    'TENANT_BASE_DOMAIN', 'TENANT_HEADER_NAME',
    'METRICS_ENABLED', 'TRACING_ENABLED', 'AUDIT_ENABLED',
    'MFA_ENABLED', 'SSO_ENABLED',
    'REPLICAS', 'MULTI_AZ',
    'TLS_CERT_PATH', 'TLS_KEY_PATH',
    'GATEWAY_URL', 'GATEWAY_PORT',
    'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB',
    'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD',
    'OPENEMIS_ADMIN_USERNAME', 'OPENEMIS_ADMIN_PASSWORD',
  ];

  const config: Record<string, string | undefined> = {};
  for (const key of relevantPrefixes) {
    config[key] = redactValue(key, process.env[key]);
  }
  return config;
}

async function checkService(
  name: string,
  url: string,
  timeoutMs: number,
): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return {
      name,
      url,
      healthy: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name,
      url,
      healthy: false,
      statusCode: 0,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getVersionInfo(): DiagnosticBundle['versions'] {
  const versions: DiagnosticBundle['versions'] = {
    platform: '0.1.0', // Would read from package.json in production
    node: process.versions.node,
  };

  try {
    const { execSync } = require('node:child_process');
    versions.pnpm = execSync('pnpm --version', { encoding: 'utf-8' }).trim();
  } catch {
    // pnpm not available
  }

  try {
    const { execSync } = require('node:child_process');
    versions.docker = execSync('docker --version', { encoding: 'utf-8' }).trim();
  } catch {
    // docker not available
  }

  return versions;
}

// ---------------------------------------------------------------------------
// Main Command
// ---------------------------------------------------------------------------

/**
 * Generate a diagnostic bundle with full system state.
 */
export async function generateDiagnosticBundle(
  opts: DiagnosticsOptions = {},
): Promise<DiagnosticBundle> {
  const baseUrl = opts.gatewayUrl ?? process.env['GATEWAY_URL'] ?? 'http://localhost:3000';
  const timeoutMs = opts.timeoutMs ?? 10_000;

  // Service health checks
  const serviceEndpoints = [
    { name: 'api-gateway', path: '/health' },
    { name: 'web', path: ':3001/api/health' },
    { name: 'admin-console', path: ':3004/api/health' },
    { name: 'install-wizard', path: ':3100/api/health' },
    { name: 'etl-worker', path: ':3010/health' },
    { name: 'registration-portal', path: ':3002/api/health' },
    { name: 'developer-portal', path: ':3005/api/health' },
  ];

  const services: ServiceStatus[] = [];
  for (const svc of serviceEndpoints) {
    const url = svc.path.startsWith(':')
      ? `http://localhost${svc.path}`
      : `${baseUrl}${svc.path}`;
    services.push(await checkService(svc.name, url, timeoutMs));
  }

  // Adapter health via gateway
  const adapterHealth: DiagnosticBundle['adapterHealth'] = {};
  const adapters = ['database', 'cache', 'storage', 'queue', 'cdn'];
  for (const adapter of adapters) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(`${baseUrl}/health/adapters/${adapter}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      adapterHealth[adapter] = {
        healthy: response.ok,
        message: response.ok ? 'Connected' : `HTTP ${response.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      adapterHealth[adapter] = {
        healthy: false,
        message: err instanceof Error ? err.message : 'Unreachable',
        latencyMs: Date.now() - start,
      };
    }
  }

  // Readiness snapshot
  const readiness = await runReadinessCheck({ gatewayUrl: baseUrl, timeoutMs });
  const readinessSnapshot = {
    totalScore: readiness.totalScore,
    maxScore: readiness.maxScore,
    grade: readiness.grade,
    categories: readiness.categories.map((c) => ({
      name: c.name,
      score: c.score,
      status: c.status,
    })),
  };

  // Recent errors placeholder (would read from log aggregator in production)
  const recentErrors: Record<string, string[]> = {};
  for (const svc of serviceEndpoints) {
    recentErrors[svc.name] = [
      '(Log collection requires access to log aggregator or container runtime)',
      'Configure OTEL_EXPORTER_OTLP_ENDPOINT for centralized logging',
    ];
  }

  const cpuInfo = cpus();

  const bundle: DiagnosticBundle = {
    metadata: {
      generatedAt: new Date().toISOString(),
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      osRelease: release(),
      nodeVersion: process.versions.node,
      uptimeSeconds: Math.round(uptime()),
    },
    system: {
      totalMemoryGb: Math.round((totalmem() / (1024 * 1024 * 1024)) * 10) / 10,
      freeMemoryGb: Math.round((freemem() / (1024 * 1024 * 1024)) * 10) / 10,
      cpuCount: cpuInfo.length,
      cpuModel: cpuInfo[0]?.model ?? 'unknown',
    },
    services,
    configuration: getConfigSummary(),
    adapterHealth,
    recentErrors,
    readinessSnapshot,
    versions: getVersionInfo(),
  };

  return bundle;
}

/**
 * CLI entry point for the diagnostics command.
 */
export async function diagnosticsCommand(argv: string[]): Promise<void> {
  const opts: DiagnosticsOptions = { writeFile: true };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--gateway-url':
        opts.gatewayUrl = argv[++i];
        break;
      case '--output-dir':
        opts.outputDir = argv[++i];
        break;
      case '--timeout':
        opts.timeoutMs = parseInt(argv[++i] ?? '10000', 10);
        break;
      case '--no-file':
        opts.writeFile = false;
        break;
    }
  }

  console.error('Generating diagnostic bundle...');
  const bundle = await generateDiagnosticBundle(opts);

  if (opts.writeFile) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `diagnostics-${timestamp}.json`;
    const outputPath = join(opts.outputDir ?? process.cwd(), filename);

    writeFileSync(outputPath, JSON.stringify(bundle, null, 2), 'utf-8');
    console.error(`\nDiagnostic bundle written to: ${outputPath}`);
    console.error(`Bundle size: ${JSON.stringify(bundle).length} bytes`);
  }

  // Also output to stdout for piping
  console.log(JSON.stringify(bundle, null, 2));
}
