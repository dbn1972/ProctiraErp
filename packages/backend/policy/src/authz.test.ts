/**
 * Policy in-package authorization + platform-scope authorship tests.
 *
 * PRC-M606 / PRC-M609 / PRC-M630 — the parked policy package must still enforce,
 * in-package, that only a tenant admin (or platform admin) may create, update,
 * activate, deactivate, assign or un-assign a policy for the current tenant.
 * PRC-M610 — only a platform admin may author (create/update) a `platform`-scope
 * policy, or assign a policy to the `platform` target; a tenant admin is 403.
 *
 * Failing-first: on the base source (no guard) a non-admin caller succeeds
 * (201/200) and a tenant admin can create a platform-scope policy; with the fix
 * each unauthorised mutation is 403.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { InMemoryPolicyRepository } from './in-memory-repository.js';
import { policyPlugin } from './policy-plugin.js';

let app: FastifyInstance;

/** Role headers: x-roles is a comma-separated list of role ids; x-sub the actor. */
function headers(roles: string, sub = 'user-1'): Record<string, string> {
  return { 'x-roles': roles, 'x-sub': sub };
}

const PLATFORM = 'platform_admin';
const TENANT = 'tenant_admin';
const TEACHER = 'teacher';
const tenantId = 'tenant-001';

const tenantPolicyBody = {
  name: 'Tenant Password Policy',
  type: 'password_complexity',
  scope: 'tenant',
  rules: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: false,
  },
  priority: 100,
};

const platformPolicyBody = {
  ...tenantPolicyBody,
  name: 'Platform Password Policy',
  scope: 'platform',
};

beforeEach(async () => {
  app = Fastify();
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const r = request as unknown as FastifyRequest & {
      tenantId: string;
      user: { sub?: string; roles: { roleId: string }[] };
    };
    r.tenantId = tenantId;
    const sub = (request.headers['x-sub'] as string) || '';
    const roleHeader = (request.headers['x-roles'] as string) || '';
    r.user = {
      ...(sub ? { sub } : {}),
      roles: roleHeader
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((roleId) => ({ roleId })),
    };
  });
  const repository = new InMemoryPolicyRepository();
  await app.register(policyPlugin, { repository });
  await app.ready();
});

/** Create an active tenant-scope policy as a tenant admin; return its id. */
async function createActivePolicy(): Promise<string> {
  const createRes = await app.inject({
    method: 'POST',
    url: '/policies',
    headers: headers(TENANT),
    payload: tenantPolicyBody,
  });
  expect(createRes.statusCode).toBe(201);
  const id = createRes.json().id as string;
  const activateRes = await app.inject({
    method: 'POST',
    url: `/policies/${id}/activate`,
    headers: headers(TENANT),
  });
  expect(activateRes.statusCode).toBe(200);
  return id;
}

describe('PRC-M606 create/update require tenant admin', () => {
  it('rejects a non-admin (teacher) create with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/policies',
      headers: headers(TEACHER),
      payload: tenantPolicyBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('allows a tenant admin to create (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/policies',
      headers: headers(TENANT),
      payload: tenantPolicyBody,
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a non-admin update with 403', async () => {
    const id = await createActivePolicy();
    const res = await app.inject({
      method: 'PUT',
      url: `/policies/${id}`,
      headers: headers(TEACHER),
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PRC-M630 activate/deactivate require tenant admin', () => {
  it('rejects a non-admin activate with 403', async () => {
    const id = await createActivePolicy();
    await app.inject({
      method: 'POST',
      url: `/policies/${id}/deactivate`,
      headers: headers(TENANT),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/policies/${id}/activate`,
      headers: headers(TEACHER),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a non-admin deactivate with 403', async () => {
    const id = await createActivePolicy();
    const res = await app.inject({
      method: 'POST',
      url: `/policies/${id}/deactivate`,
      headers: headers(TEACHER),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PRC-M609 assign/removeAssignment require tenant admin', () => {
  it('rejects a non-admin assign with 403', async () => {
    const id = await createActivePolicy();
    const res = await app.inject({
      method: 'POST',
      url: `/policies/${id}/assignments`,
      headers: headers(TEACHER),
      payload: { policyId: id, targetType: 'tenant', targetId: tenantId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a non-admin removeAssignment with 403', async () => {
    const id = await createActivePolicy();
    const assignRes = await app.inject({
      method: 'POST',
      url: `/policies/${id}/assignments`,
      headers: headers(TENANT),
      payload: { policyId: id, targetType: 'tenant', targetId: tenantId },
    });
    const assignmentId = assignRes.json().id;
    const res = await app.inject({
      method: 'DELETE',
      url: `/policies/${id}/assignments/${assignmentId}`,
      headers: headers(TEACHER),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows a tenant admin to assign (201)', async () => {
    const id = await createActivePolicy();
    const res = await app.inject({
      method: 'POST',
      url: `/policies/${id}/assignments`,
      headers: headers(TENANT),
      payload: { policyId: id, targetType: 'tenant', targetId: tenantId },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('PRC-M610 only platform admins author platform-scope policies', () => {
  it('rejects a tenant admin creating a platform-scope policy with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/policies',
      headers: headers(TENANT),
      payload: platformPolicyBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('allows a platform admin to create a platform-scope policy (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/policies',
      headers: headers(PLATFORM),
      payload: platformPolicyBody,
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a tenant admin editing an existing platform-scope policy with 403', async () => {
    // Platform admin creates the platform-scope policy.
    const createRes = await app.inject({
      method: 'POST',
      url: '/policies',
      headers: headers(PLATFORM),
      payload: platformPolicyBody,
    });
    const id = createRes.json().id;
    // A tenant admin may not edit it.
    const res = await app.inject({
      method: 'PUT',
      url: `/policies/${id}`,
      headers: headers(TENANT),
      payload: { name: 'Renamed Platform Policy' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a tenant admin assigning to the platform target with 403', async () => {
    const id = await createActivePolicy();
    const res = await app.inject({
      method: 'POST',
      url: `/policies/${id}/assignments`,
      headers: headers(TENANT),
      payload: { policyId: id, targetType: 'platform' },
    });
    expect(res.statusCode).toBe(403);
  });
});
