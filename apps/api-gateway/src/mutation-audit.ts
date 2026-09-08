/**
 * G-105 — helpers for gateway mutation audit trail.
 */

import { createHash } from 'node:crypto';

import type { AuditOperation } from '@proctira/backend-audit';
import type { FastifyRequest } from 'fastify';

import { resourceForApiPath } from './rbac-registry.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
