/**
 * G-105 / W1-SEC-10 — helpers for gateway mutation audit trail.
 *
 * Audit write failures must be surfaced (logged). Security-sensitive mutations
 * fail closed in production unless ALLOW_MUTATION_AUDIT_DEGRADE=1.
 */

import { createHash } from 'node:crypto';

import type { AuditOperation } from '@proctira/backend-audit';
import type { FastifyRequest } from 'fastify';

import { resourceForApiPath } from './rbac-registry.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** RBAC resources where a missing audit trail is a security incident. */
const SECURITY_SENSITIVE_RESOURCES = new Set([
  'health',
  'fees',
  'scholarship',
  'student',
  'parent',
  'registration',
  'staff',
  'platform',
  'billing',
]);

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function shouldAuditMutation(method: string, url: string): boolean {
  if (!MUTATING.has(method.toUpperCase())) return false;
  const path = url.split('?')[0] ?? url;
  if (!path.startsWith('/api/v1/')) return false;
  if (path.startsWith('/api/v1/auth/') || path === '/api/v1/auth') return false;
  if (path.startsWith('/api/v1/audit-logs')) return false;
  if (path.startsWith('/docs') || path === '/docs') return false;
  if (path.startsWith('/health') || path === '/health') return false;
  return true;
}

export function operationForMethod(method: string): AuditOperation {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'CREATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return 'UPDATE';
  }
}

export function entityTypeForPath(pathname: string): string {
  const resource = resourceForApiPath(pathname);
  if (resource === 'health') return 'health_record';
  if (resource === 'platform') return 'user';
  if (resource) return resource;
  const segment = pathname.replace(/^\/api\/v1\//, '').split('/')[0];
  return segment || 'api';
}

export function entityIdFromPath(pathname: string): string {
  const path = pathname.split('?')[0] ?? pathname;
  const segments = path.split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i]!;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) {
      return seg;
    }
  }
  return segments[segments.length - 1] ?? 'collection';
}

export function hashValue(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
}

export function buildAuditValues(
  operation: AuditOperation,
  request: FastifyRequest,
): {
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
} {
  const bodyHash = hashValue(request.body);
  const path = request.url.split('?')[0] ?? request.url;

  if (operation === 'CREATE') {
    return { beforeValues: null, afterValues: { bodyHash, path } };
  }
  if (operation === 'DELETE') {
    return { beforeValues: { path }, afterValues: null };
  }
  return {
    beforeValues: { bodyHash: 'pre-mutation', path },
    afterValues: { bodyHash, path },
  };
}

/**
 * Paths whose mutations must not acknowledge success without a durable audit
 * record in production (PHI / money / custody / privacy / identity).
 */
export function isSecuritySensitiveMutationPath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? pathname;
  if (
    path.startsWith('/api/v1/billing') ||
    path.startsWith('/api/v1/tenant-lifecycle') ||
    path.startsWith('/api/v1/privacy')
  ) {
    return true;
  }
  const resource = resourceForApiPath(path);
  return resource != null && SECURITY_SENSITIVE_RESOURCES.has(resource);
}

export function isMutationAuditDegradeAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return truthy(env.ALLOW_MUTATION_AUDIT_DEGRADE);
}

/**
 * When mutation audit persistence fails: fail closed for security-sensitive
 * paths in production unless an explicit degrade flag is set.
 */
export function shouldFailClosedOnMutationAuditFailure(options: {
  path: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = options.env ?? process.env;
  if (isMutationAuditDegradeAllowed(env)) return false;
  if (!isSecuritySensitiveMutationPath(options.path)) return false;
  return (env.NODE_ENV ?? '').toLowerCase() === 'production';
}

export const MUTATION_AUDIT_UNAVAILABLE_BODY = {
  code: 'AUDIT_UNAVAILABLE',
  message:
    'Mutation audit trail unavailable; refusing to acknowledge security-sensitive mutation',
  statusCode: 503,
} as const;

export type MutationAuditRecordInput = {
  tenantId: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  userId: string;
  userName: string;
  ipAddress: string;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

export type MutationAuditRecorder = {
  recordAudit: (input: MutationAuditRecordInput) => Promise<unknown>;
};

export type MutationAuditOutcome =
  | { ok: true }
  | { ok: false; failClosed: boolean; error: unknown };

/**
 * Attempt to persist a mutation audit record. Never swallows: callers must
 * log `error` when `ok` is false. When `failClosed` is true, replace the
 * outbound success response with {@link MUTATION_AUDIT_UNAVAILABLE_BODY}.
 */
export async function persistMutationAudit(options: {
  auditService: MutationAuditRecorder | null | undefined;
  input: MutationAuditRecordInput;
  path: string;
  env?: NodeJS.ProcessEnv;
}): Promise<MutationAuditOutcome> {
  const env = options.env ?? process.env;
  try {
    if (!options.auditService || typeof options.auditService.recordAudit !== 'function') {
      throw new Error('audit service unavailable');
    }
    await options.auditService.recordAudit(options.input);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      failClosed: shouldFailClosedOnMutationAuditFailure({ path: options.path, env }),
      error,
    };
  }
}
