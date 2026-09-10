/**
 * Enterprise Readiness Score Command
 *
 * Scores the deployment across 10 categories (10 pts each, 100 total):
 * 1. HTTPS enabled (10 pts)
 * 2. Secure secrets management (10 pts)
 * 3. Admin account created (10 pts)
 * 4. MFA/SSO configured (10 pts)
 * 5. Database backup configured (10 pts)
 * 6. Object storage ready (10 pts)
 * 7. Queue + DLQ ready (10 pts)
 * 8. Monitoring configured (10 pts)
 * 9. Audit enabled (10 pts)
 * 10. HA posture (10 pts)
 *
 * Output: score out of 100 with pass/warning/fail per category.
 */

import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReadinessStatus = 'pass' | 'warning' | 'fail';

export interface ReadinessCategory {
  name: string;
  description: string;
  status: ReadinessStatus;
  score: number;
  maxScore: number;
  message: string;
  recommendations?: string[];
}

export interface ReadinessReport {
  timestamp: string;
  totalScore: number;
  maxScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  overallStatus: ReadinessStatus;
  categories: ReadinessCategory[];
}

export interface ReadinessOptions {
  /** Base URL of the API gateway */
  gatewayUrl?: string;
  /** Timeout per check in ms */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envSet(name: string): boolean {
  const val = process.env[name];
  return val !== undefined && val !== '' && val !== 'undefined';
}

async function httpGet(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: '' };
  }
}

function computeGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ---------------------------------------------------------------------------
// Category Checks
// ---------------------------------------------------------------------------

function checkHttps(): ReadinessCategory {
  const tlsCert = process.env['TLS_CERT_PATH'];
  const tlsKey = process.env['TLS_KEY_PATH'];
  const forceHttps = process.env['FORCE_HTTPS'] === 'true';
  const nodeEnv = process.env['NODE_ENV'];

  const certExists = tlsCert ? existsSync(tlsCert) : false;
  const keyExists = tlsKey ? existsSync(tlsKey) : false;

  if ((certExists && keyExists) || forceHttps) {
    return {
      name: 'https',
      description: 'HTTPS/TLS encryption enabled',
      status: 'pass',
      score: 10,
      maxScore: 10,
      message: 'HTTPS is properly configured',
    };
  }

  if (nodeEnv === 'development') {
    return {
      name: 'https',
      description: 'HTTPS/TLS encryption enabled',
      status: 'warning',
      score: 5,
      maxScore: 10,
      message: 'HTTPS not configured (acceptable for development)',
      recommendations: ['Configure TLS certificates for production deployment'],
    };
  }

  return {
    name: 'https',
    description: 'HTTPS/TLS encryption enabled',
    status: 'fail',
    score: 0,
    maxScore: 10,
    message: 'HTTPS not configured — production traffic is unencrypted',
    recommendations: [
      'Set TLS_CERT_PATH and TLS_KEY_PATH environment variables',
      'Use a reverse proxy (nginx/traefik) with TLS termination',
      "Consider Let's Encrypt for automated certificate management",
    ],
  };
}

function checkSecrets(): ReadinessCategory {
  const jwtSecret = process.env['JWT_SECRET'];
  const cookieSecret = process.env['COOKIE_SECRET'];
  const dbPassword = process.env['POSTGRES_PASSWORD'];

  const weakSecrets: string[] = [];
  const defaultValues = ['changeme', 'secret', 'password', 'proctira_dev_password', 'dev'];

  if (jwtSecret && defaultValues.some((d) => jwtSecret.toLowerCase().includes(d))) {
    weakSecrets.push('JWT_SECRET');
  }
  if (cookieSecret && defaultValues.some((d) => cookieSecret.toLowerCase().includes(d))) {
    weakSecrets.push('COOKIE_SECRET');
  }
  if (dbPassword && defaultValues.some((d) => dbPassword.toLowerCase().includes(d))) {
    weakSecrets.push('POSTGRES_PASSWORD');
  }

  if (!jwtSecret || !cookieSecret) {
    return {
      name: 'secrets',
      description: 'Secure secrets management',
      status: 'fail',
      score: 0,
      maxScore: 10,
      message: 'Critical secrets not configured (JWT_SECRET, COOKIE_SECRET)',
      recommendations: [
        'Generate cryptographically random secrets (min 32 bytes)',
        'Use a secrets manager (Vault, AWS Secrets Manager, etc.)',
      ],
    };
  }

  if (weakSecrets.length > 0) {
    return {
      name: 'secrets',
      description: 'Secure secrets management',
      status: 'warning',
      score: 5,
      maxScore: 10,
      message: `Weak/default secrets detected: ${weakSecrets.join(', ')}`,
      recommendations: [
        'Replace default secrets with cryptographically random values',
        'Use: openssl rand -base64 32',
      ],
    };
  }

  return {
    name: 'secrets',
    description: 'Secure secrets management',
    status: 'pass',
    score: 10,
    maxScore: 10,
    message: 'All secrets are configured with non-default values',
  };
}

async function checkAdmin(baseUrl: string, timeoutMs: number): Promise<ReadinessCategory> {
  // Check if admin credentials are configured
  const adminUser = process.env['OPENEMIS_ADMIN_USERNAME'];
  const adminPass = process.env['OPENEMIS_ADMIN_PASSWORD'];

  if (!adminUser || !adminPass) {
    return {
      name: 'admin',
      description: 'Admin account created',
      status: 'warning',
      score: 5,
      maxScore: 10,
      message: 'Admin credentials not found in environment — cannot verify account exists',
      recommendations: ['Run the install wizard or CLI to create the initial admin account'],
    };
  }

  // Try to verify via health endpoint
  const result = await httpGet(`${baseUrl}/health`, timeoutMs);
  if (result.ok) {
    return {
      name: 'admin',
      description: 'Admin account created',
      status: 'pass',
      score: 10,
      maxScore: 10,
      message: 'Admin account is configured and platform is accessible',
    };
  }

  return {
    name: 'admin',
    description: 'Admin account created',
    status: 'warning',
    score: 5,
    maxScore: 10,
    message: 'Platform not reachable — cannot verify admin account',
    recommendations: ['Ensure the API gateway is running and accessible'],
  };
}

function checkMfaSso(): ReadinessCategory {
  const ssoEnabled = envSet('SSO_ENABLED') && process.env['SSO_ENABLED'] === 'true';
  const mfaEnabled = envSet('MFA_ENABLED') && process.env['MFA_ENABLED'] === 'true';
  const samlMetadata = envSet('SAML_METADATA_URL');
  const oidcIssuer = envSet('OIDC_ISSUER_URL');

  if ((ssoEnabled || samlMetadata || oidcIssuer) && mfaEnabled) {
    return {
      name: 'mfa-sso',
      description: 'MFA/SSO configured',
      status: 'pass',
      score: 10,
      maxScore: 10,
      message: 'MFA and SSO are both configured',
    };
  }

  if (ssoEnabled || samlMetadata || oidcIssuer || mfaEnabled) {
    return {
      name: 'mfa-sso',
      description: 'MFA/SSO configured',
      status: 'warning',
      score: 7,
      maxScore: 10,
      message: 'Partial authentication hardening — either MFA or SSO is configured but not both',
      recommendations: [
        mfaEnabled
          ? 'Configure SSO (SAML/OIDC) for enterprise identity federation'
          : 'Enable MFA for all admin accounts',
      ],
    };
  }

  return {
    name: 'mfa-sso',
    description: 'MFA/SSO configured',
    status: 'fail',
    score: 0,
    maxScore: 10,
    message: 'Neither MFA nor SSO is configured',
    recommendations: [
      'Enable MFA_ENABLED=true for multi-factor authentication',
      'Configure OIDC_ISSUER_URL or SAML_METADATA_URL for SSO',
    ],
  };
}

function checkDatabaseBackup(): ReadinessCategory {
  const backupEnabled = envSet('DB_BACKUP_ENABLED') && process.env['DB_BACKUP_ENABLED'] === 'true';
  const backupSchedule = envSet('DB_BACKUP_SCHEDULE');

  if (backupEnabled && backupSchedule) {
    return {
      name: 'db-backup',
      description: 'Database backup configured',
      status: 'pass',
      score: 10,
      maxScore: 10,
      message: `Database backup enabled (schedule: ${process.env['DB_BACKUP_SCHEDULE'] ?? ''})`,
    };
  }

  if (backupEnabled) {
    return {
      name: 'db-backup',
      description: 'Database backup configured',
      status: 'warning',
      score: 7,
      maxScore: 10,
      message: 'Backup enabled but schedule not configured',
      recommendations: ['Set DB_BACKUP_SCHEDULE (e.g., "0 2 * * *" for daily at 2 AM)'],
    };
  }

  return {
    name: 'db-backup',
    description: 'Database backup configured',
    status: 'fail',
    score: 0,
    maxScore: 10,
    message: 'Database backup not configured — data loss risk',
    recommendations: [
      'Set DB_BACKUP_ENABLED=true',
      'Configure DB_BACKUP_SCHEDULE with a cron expression',
      'Set DB_BACKUP_RETENTION_DAYS (recommended: 30)',
      'Test restore procedure regularly',
    ],
  };
}

function checkObjectStorage(): ReadinessCategory {
  const endpoint = envSet('S3_ENDPOINT');
  const bucket = envSet('S3_BUCKET');
  const accessKey = envSet('S3_ACCESS_KEY');
  const secretKey = envSet('S3_SECRET_KEY');

  if (endpoint && bucket && accessKey && secretKey) {
    return {
      name: 'object-storage',
      description: 'Object storage ready',
      status: 'pass',
      score: 10,
      maxScore: 10,
      message: 'Object storage (S3/MinIO) fully configured',
    };
  }

  const missing: string[] = [];
  if (!endpoint) missing.push('S3_ENDPOINT');
  if (!bucket) missing.push('S3_BUCKET');
  if (!accessKey) missing.push('S3_ACCESS_KEY');
  if (!secretKey) missing.push('S3_SECRET_KEY');

  return {
    name: 'object-storage',
    description: 'Object storage ready',
    status: 'fail',
    score: 0,
    maxScore: 10,
    message: `Object storage not fully configured — missing: ${missing.join(', ')}`,
    recommendations: [
      'Configure all S3/MinIO environment variables for file uploads and attachments',
    ],
  };
}

function checkQueue(): ReadinessCategory {
  const rabbitmqUrl = envSet('RABBITMQ_URL');
  const kafkaBrokers = envSet('KAFKA_BROKERS');
  const dlqEnabled = envSet('DLQ_ENABLED') && process.env['DLQ_ENABLED'] === 'true';

  if ((rabbitmqUrl || kafkaBrokers) && dlqEnabled) {
    return {
      name: 'queue-dlq',
      description: 'Queue + DLQ ready',
      status: 'pass',
      score: 10,
      maxScore: 10,
      message: 'Message queue and dead-letter queue configured',
    };
  }

  if (rabbitmqUrl || kafkaBrokers) {
    return {
      name: 'queue-dlq',
      description: 'Queue + DLQ ready',
      status: 'warning',
      score: 7,
      maxScore: 10,
      message: 'Queue configured but DLQ not explicitly enabled',
      recommendations: ['Set DLQ_ENABLED=true to ensure failed messages are captured'],
    };
  }

  return {
    name: 'queue-dlq',
    description: 'Queue + DLQ ready',
    status: 'fail',
    score: 0,
    maxScore: 10,
    message: 'No message queue configured',
    recommendations: [
      'Set RABBITMQ_URL or KAFKA_BROKERS',
      'Enable DLQ_ENABLED=true for dead-letter handling',
    ],
  };
}

function checkMonitoring(): ReadinessCategory {
  // Honest scope (G-725): every Fastify service registers @proctira/observability
  // and serves Prometheus /metrics unconditionally; METRICS_ENABLED=false is the
  // only way to opt out. Distributed tracing is NOT implemented — no OpenTelemetry
  // SDK or exporter is wired — so TRACING_ENABLED / OTEL_EXPORTER_OTLP_ENDPOINT
  // must not earn readiness points.
  const metricsDisabled = process.env['METRICS_ENABLED'] === 'false';
  const alertingConfigured =
    envSet('ALERTING_WEBHOOK_URL') ||
    envSet('PAGERDUTY_INTEGRATION_KEY') ||
    envSet('SLACK_WEBHOOK_URL') ||
    envSet('ALERT_EMAIL_TO');
  const tracingRequested = envSet('TRACING_ENABLED') || envSet('OTEL_EXPORTER_OTLP_ENDPOINT');

  let score = 0;
  const active: string[] = [];
  const missing: string[] = [];
  const recommendations: string[] = [];

  if (!metricsDisabled) {
    score += 5;
    active.push('metrics (Prometheus /metrics)');
  } else {
    missing.push('metrics');
    recommendations.push(
      'Unset METRICS_ENABLED=false — Prometheus /metrics is the only metrics path',
    );
  }

  if (alertingConfigured) {
    score += 5;
    active.push('alerting');
  } else {
    missing.push('alerting');
    recommendations.push(
      'Set ALERT_EMAIL_TO plus PAGERDUTY_INTEGRATION_KEY / SLACK_WEBHOOK_URL (infra/observability/render-alertmanager.sh), or ALERTING_WEBHOOK_URL',
    );
  }

  if (tracingRequested) {
    recommendations.push(
      'TRACING_ENABLED / OTEL_EXPORTER_OTLP_ENDPOINT have no effect: distributed tracing is not implemented in this release (metrics + request-id log correlation only)',
    );
  }

  if (score >= 10) {
    return {
      name: 'monitoring',
      description: 'Monitoring configured',
      status: 'pass',
      score: 10,
      maxScore: 10,
      message: 'Metrics + alerting configured (tracing: not available in this release)',
      ...(recommendations.length > 0 ? { recommendations } : {}),
    };
  }

  if (score > 0) {
    return {
      name: 'monitoring',
      description: 'Monitoring configured',
      status: 'warning',
      score,
      maxScore: 10,
      message: `Partial monitoring: ${active.join(', ')} active; missing: ${missing.join(', ')}`,
      recommendations,
    };
  }

  return {
    name: 'monitoring',
    description: 'Monitoring configured',
    status: 'fail',
    score: 0,
    maxScore: 10,
    message: 'No monitoring configured — blind to production issues',
    recommendations,
  };
}

function checkAudit(): ReadinessCategory {
  const auditEnabled = process.env['AUDIT_ENABLED'] !== 'false';
  const auditRetention = envSet('AUDIT_RETENTION_DAYS');

  if (auditEnabled && auditRetention) {
    return {
      name: 'audit',
      description: 'Audit logging enabled',
      status: 'pass',
      score: 10,
      maxScore: 10,
      message: `Audit logging enabled with ${process.env['AUDIT_RETENTION_DAYS'] ?? ''}-day retention`,
    };
  }

  if (auditEnabled) {
    return {
      name: 'audit',
      description: 'Audit logging enabled',
      status: 'warning',
      score: 7,
      maxScore: 10,
      message: 'Audit logging enabled but retention policy not set',
      recommendations: ['Set AUDIT_RETENTION_DAYS (recommended: 365 for compliance)'],
    };
  }

  return {
    name: 'audit',
    description: 'Audit logging enabled',
    status: 'fail',
    score: 0,
    maxScore: 10,
    message: 'Audit logging disabled — compliance risk',
    recommendations: [
      'Ensure AUDIT_ENABLED is not set to false',
      'Set AUDIT_RETENTION_DAYS for log retention policy',
    ],
  };
}

function checkHaPosture(): ReadinessCategory {
  const replicas = parseInt(process.env['REPLICAS'] ?? '1', 10);
  const dbReplicas = envSet('DB_READ_REPLICAS');
  const redisCluster = envSet('REDIS_CLUSTER_NODES');
  const multiAz = envSet('MULTI_AZ') && process.env['MULTI_AZ'] === 'true';

  let score = 0;
  const features: string[] = [];
  const missing: string[] = [];

  if (replicas > 1) {
    score += 3;
    features.push(`${replicas} app replicas`);
  } else {
    missing.push('multiple app replicas');
  }

  if (dbReplicas) {
    score += 3;
    features.push('DB read replicas');
  } else {
    missing.push('DB read replicas');
  }

  if (redisCluster) {
    score += 2;
    features.push('Redis cluster');
  } else {
    missing.push('Redis cluster/sentinel');
  }

  if (multiAz) {
    score += 2;
    features.push('multi-AZ');
  } else {
    missing.push('multi-AZ deployment');
  }

  if (score >= 10) {
    return {
      name: 'ha-posture',
      description: 'High availability posture',
      status: 'pass',
      score: 10,
      maxScore: 10,
      message: `HA configured: ${features.join(', ')}`,
    };
  }

  if (score > 0) {
    return {
      name: 'ha-posture',
      description: 'High availability posture',
      status: 'warning',
      score,
      maxScore: 10,
      message: `Partial HA: ${features.join(', ')}; missing: ${missing.join(', ')}`,
      recommendations: missing.map((m) => `Configure ${m} for production resilience`),
    };
  }

  return {
    name: 'ha-posture',
    description: 'High availability posture',
    status: 'fail',
    score: 0,
    maxScore: 10,
    message: 'Single-instance deployment — no high availability',
    recommendations: [
      'Set REPLICAS > 1 for application redundancy',
      'Configure DB_READ_REPLICAS for database HA',
      'Use REDIS_CLUSTER_NODES for cache HA',
      'Enable MULTI_AZ=true for zone redundancy',
    ],
  };
}

// ---------------------------------------------------------------------------
// Main Command
// ---------------------------------------------------------------------------

/**
 * Run the enterprise readiness assessment and return a scored report.
 */
export async function runReadinessCheck(opts: ReadinessOptions = {}): Promise<ReadinessReport> {
  const baseUrl = opts.gatewayUrl ?? process.env['GATEWAY_URL'] ?? 'http://localhost:3000';
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const categories: ReadinessCategory[] = [];

  categories.push(checkHttps());
  categories.push(checkSecrets());
  categories.push(await checkAdmin(baseUrl, timeoutMs));
  categories.push(checkMfaSso());
  categories.push(checkDatabaseBackup());
  categories.push(checkObjectStorage());
  categories.push(checkQueue());
  categories.push(checkMonitoring());
  categories.push(checkAudit());
  categories.push(checkHaPosture());

  const totalScore = categories.reduce((sum, c) => sum + c.score, 0);
  const maxScore = categories.reduce((sum, c) => sum + c.maxScore, 0);
  const grade = computeGrade(totalScore);

  const hasFail = categories.some((c) => c.status === 'fail');
  const hasWarning = categories.some((c) => c.status === 'warning');
  const overallStatus: ReadinessStatus = hasFail ? 'fail' : hasWarning ? 'warning' : 'pass';

  return {
    timestamp: new Date().toISOString(),
    totalScore,
    maxScore,
    grade,
    overallStatus,
    categories,
  };
}

/**
 * CLI entry point for the readiness command.
 */
export async function readinessCommand(argv: string[]): Promise<void> {
  const opts: ReadinessOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--gateway-url':
        opts.gatewayUrl = argv[++i];
        break;
      case '--timeout':
        opts.timeoutMs = parseInt(argv[++i] ?? '10000', 10);
        break;
    }
  }

  const report = await runReadinessCheck(opts);

  // Print human-readable summary to stderr, JSON to stdout
  console.error('');
  console.error('╔══════════════════════════════════════════════════╗');
  console.error('║       Enterprise Readiness Score                 ║');
  console.error('╚══════════════════════════════════════════════════╝');
  console.error('');
  console.error(`  Score: ${report.totalScore}/${report.maxScore} (Grade: ${report.grade})`);
  console.error('');

  for (const cat of report.categories) {
    const icon = cat.status === 'pass' ? '✓' : cat.status === 'warning' ? '⚠' : '✗';
    console.error(`  ${icon} [${cat.score}/${cat.maxScore}] ${cat.name}: ${cat.message}`);
  }
  console.error('');

  // Machine-readable JSON to stdout
  console.log(JSON.stringify(report, null, 2));

  if (report.overallStatus === 'fail') {
    process.exitCode = 1;
  }
}
