/**
 * PRC-L298 / DR4-1 — inbound developer-portal API keys authenticate in the
 * app.ts auth hook and are authorised only by the (shipped: empty) scope table,
 * through the real hook chain (header strip → tenantPlugin → suspension /
 * tenant-session revocation → RBAC).
 */
import { MemoryTenantSessionRevocationStore } from '@proctira/backend-auth';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OTHER_TENANT_ID, TEST_TENANT_ID, createTestConfig } from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';
import type {
  ApiKeyCredentialLookup,
  ApiKeyCredentialRecord,
  ApiKeyScopeGrant,
} from './credential-principals.js';
import { noteTenantStatusChange } from './tenant-entitlement.js';

delete process.env['DATABASE_URL'];

const key = (n: number) => `oem_${n.toString(16).padStart(32, '0')}`;
const KEY_STUDENTS = key(1);
const KEY_FREEFORM = key(2);
const KEY_REVOKED = key(3);
const KEY_EXPIRED = key(4);
const KEY_OTHER_TENANT = key(5);
const KEY_HARD_DENY = key(6);
const KEY_OLD = key(7);

const minuteAgo = new Date(Date.now() - 60_000);
const records: Record<string, ApiKeyCredentialRecord> = {
  [KEY_STUDENTS]: rec('k-students', TEST_TENANT_ID, ['students:read', 'institutions:read']),
  [KEY_FREEFORM]: rec('k-free', TEST_TENANT_ID, ['read', 'read:all', 'write:students']),
  [KEY_REVOKED]: { ...rec('k-revoked', TEST_TENANT_ID, ['students:read']), status: 'revoked' },
  [KEY_EXPIRED]: {
    ...rec('k-expired', TEST_TENANT_ID, ['students:read']),
    expiresAt: new Date(Date.now() - 1_000),
  },
  [KEY_OTHER_TENANT]: rec('k-other', OTHER_TENANT_ID, ['institutions:read']),
  [KEY_HARD_DENY]: rec('k-deny', TEST_TENANT_ID, [
    'health:read',
    'fees:read',
    'staff:read',
    'users:read',
    'platform:read',
    'cases:read',
  ]),
  [KEY_OLD]: { ...rec('k-old', TEST_TENANT_ID, ['institutions:read']), createdAt: minuteAgo },
};

function rec(id: string, tenantId: string, scopes: string[]): ApiKeyCredentialRecord {
  return {
    id,
    tenantId,
    status: 'active',
    scopes,
    expiresAt: null,
    createdAt: new Date(Date.now() + 2_000),
  };
}

const lookup: ApiKeyCredentialLookup = { findByKey: async (raw) => records[raw] ?? null };

const INJECTED_TABLE: Record<string, ApiKeyScopeGrant> = {
  'students:read': { resource: 'student', action: 'read' },
  'institutions:read': { resource: 'institution', action: 'read' },
  // Hard-denied resources stay denied even when a table maps them.
  'health:read': { resource: 'health', action: 'read' },
  'fees:read': { resource: 'fees', action: 'read' },
  'staff:read': { resource: 'staff', action: 'read' },
  'users:read': { resource: 'user', action: 'read' },
  'platform:read': { resource: 'platform', action: 'read' },
  'cases:read': { resource: 'case', action: 'read' },
};

const GATEWAY_SCOPE_DENIAL = 'API key scopes do not grant this resource';

const bearer = (k: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${k}`,
  ...extra,
});

describe('PRC-L298 API keys with an injected scope table', () => {
  let app: FastifyInstance;
  const revocation = new MemoryTenantSessionRevocationStore();
  beforeAll(async () => {
    app = await buildApp({
      config: createTestConfig(),
      tenantSessionRevocationStore: revocation,
      credentialPrincipals: { apiKeyLookup: lookup, apiKeyScopeTable: INJECTED_TABLE },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('an in-scope key reads GET /api/v1/institutions (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/institutions',
      headers: bearer(KEY_STUDENTS),
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('students:read clears the gateway; the student domain still applies its own role check', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/students',
      headers: bearer(KEY_STUDENTS),
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.json().message).not.toBe(GATEWAY_SCOPE_DENIAL);
  });

  it('non-read actions stay 403 even for an in-scope key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: bearer(KEY_STUDENTS),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it.each([
    '/api/v1/health/records',
    '/api/v1/fees/invoices',
    '/api/v1/staff',
    '/api/v1/tenant/users',
    '/api/v1/tenants',
    '/api/v1/workflow-engine/cases',
    '/api/v1/privacy/requests',
    '/api/v1/audit-logs',
  ])('a hard-denied resource stays 403 despite a table entry: GET %s', async (url) => {
    const res = await app.inject({ method: 'GET', url, headers: bearer(KEY_HARD_DENY) });
    expect(res.statusCode).toBe(403);
  });

  it('free-form / unknown scopes grant nothing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/students',
      headers: bearer(KEY_FREEFORM),
    });
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ['GET', '/api/v1/billing/me/entitlements'],
    ['GET', '/api/v1/notifications'],
    ['GET', '/api/v1/meta/error-codes'],
    ['GET', '/api/v1/services'],
  ] as const)(
    'DR4-1: self-service / utility routes are 403 for keys: %s %s',
    async (method, url) => {
      const res = await app.inject({ method, url, headers: bearer(KEY_STUDENTS) });
      expect(res.statusCode).toBe(403);
    },
  );

  it.each(['/api/v1/auth/me', '/api/v1/auth/roles', '/api/v1/scim/v2/Users', '/tenants/mine'])(
    'keys are never accepted on %s (401)',
    async (url) => {
      const res = await app.inject({ method: 'GET', url, headers: bearer(KEY_STUDENTS) });
      expect(res.statusCode).toBe(401);
    },
  );

  it('revoked, expired and unknown keys -> 401', async () => {
    for (const k of [KEY_REVOKED, KEY_EXPIRED, key(99)]) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/students', headers: bearer(k) });
      expect(res.statusCode, k).toBe(401);
    }
  });

  it('the tenant comes from the key record: a spoofed x-tenant-id is ignored', async () => {
    noteTenantStatusChange(OTHER_TENANT_ID, 'suspended');
    try {
      // Header names the suspended tenant; the key's own (active) tenant is used.
      const spoofed = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: bearer(KEY_STUDENTS, { 'x-tenant-id': OTHER_TENANT_ID }),
      });
      expect(spoofed.statusCode, spoofed.body).toBe(200);
      // A key of the suspended tenant is refused by the suspension gate.
      const suspended = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: bearer(KEY_OTHER_TENANT),
      });
      expect(suspended.statusCode).toBe(403);
      expect(suspended.json().code).toBe('TENANT_SUSPENDED');
    } finally {
      noteTenantStatusChange(OTHER_TENANT_ID, 'active');
    }
  });

  it('a key created before a tenant-wide revocation -> 401 SESSION_REVOKED; a later one passes', async () => {
    await revocation.revokeTenantSessions(TEST_TENANT_ID, Math.floor(Date.now() / 1000) - 30, 3600);
    try {
      const old = await app.inject({
        method: 'GET',
        url: '/api/v1/students',
        headers: bearer(KEY_OLD),
      });
      expect(old.statusCode).toBe(401);
      expect(old.json().code).toBe('SESSION_REVOKED');
      const fresh = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: bearer(KEY_STUDENTS),
      });
      expect(fresh.statusCode, fresh.body).toBe(200);
    } finally {
      revocation.clear();
    }
  });
});

describe('PRC-L298 API keys with the shipped (empty) scope table', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({
      config: createTestConfig(),
      credentialPrincipals: { apiKeyLookup: lookup },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a valid key authenticates but every resource is 403', async () => {
    for (const url of ['/api/v1/students', '/api/v1/institutions', '/api/v1/timetable']) {
      const res = await app.inject({ method: 'GET', url, headers: bearer(KEY_STUDENTS) });
      expect(res.statusCode, url).toBe(403);
      expect(res.json().message).toBe(GATEWAY_SCOPE_DENIAL);
    }
  });
});
