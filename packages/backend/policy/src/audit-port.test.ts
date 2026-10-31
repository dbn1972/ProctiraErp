/**
 * PRC-M608 — policy audit via an injected AuditPort with the real actor and tenant.
 *
 * Failing-first:
 *   - On the base source the policy routes write NO audit row for lifecycle
 *     mutations and the service takes no actor, so an injected port would never
 *     be called. With the fix an injected port receives every lifecycle event
 *     carrying the REAL actor (`sub`) and tenant.
 *   - On the base source a mutation with no verified actor still succeeds. With
 *     the fix a mutation without a verified `sub` is 401 (ACTOR_REQUIRED) and
 *     no audit row is written.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import type { PolicyAuditEvent, PolicyAuditPort } from './audit-port.js';
import { InMemoryPolicyRepository } from './in-memory-repository.js';
import { policyPlugin } from './policy-plugin.js';

class RecordingAuditPort implements PolicyAuditPort {
  readonly events: PolicyAuditEvent[] = [];
  async record(event: PolicyAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

const tenantId = 'tenant-xyz';

const tenantPolicyBody = {
  name: 'Audited Policy',
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

let port: RecordingAuditPort;
let app: FastifyInstance;

/**
 * Build an app whose principal is controlled per-request via headers:
 *   x-sub: the verified actor id (absent/blank = no verified actor)
 *   x-roles: comma-separated role ids
 */
async function buildApp(auditPort?: PolicyAuditPort): Promise<FastifyInstance> {
  const a = Fastify();
  a.decorateRequest('tenantId', '');
  a.decorateRequest('user', null);
  a.addHook('onRequest', async (request) => {
    const r = request as unknown as FastifyRequest & {
      tenantId: string;
      user: { sub?: string; roles: { roleId: string }[] };
    };
    r.tenantId = (request.headers['x-tenant-id'] as string) || tenantId;
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
  await a.register(policyPlugin, { repository: new InMemoryPolicyRepository(), auditPort });
  await a.ready();
  return a;
}

beforeEach(async () => {
  port = new RecordingAuditPort();
  app = await buildApp(port);
});

describe('PRC-M608 injected AuditPort receives the real actor and tenant', () => {
  it('records create and activate through the port with the real sub and tenant', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/policies',
      headers: { 'x-sub': 'alice', 'x-roles': 'tenant_admin' },
      payload: tenantPolicyBody,
    });
    expect(createRes.statusCode).toBe(201);
    const policyId = createRes.json().id;

    const activateRes = await app.inject({
      method: 'POST',
      url: `/policies/${policyId}/activate`,
      headers: { 'x-sub': 'bob', 'x-roles': 'tenant_admin' },
    });
    expect(activateRes.statusCode).toBe(200);

    const create = port.events.find((e) => e.action === 'create');
    const activate = port.events.find((e) => e.action === 'activate');
    expect(create?.actor).toBe('alice');
    expect(create?.tenantId).toBe(tenantId);
    expect(create?.policyId).toBe(policyId);
    expect(activate?.actor).toBe('bob');
    // The literal 'system' actor must never be recorded for an authenticated mutation.
    expect(port.events.every((e) => e.actor !== 'system')).toBe(true);
    expect(port.events.every((e) => e.tenantId === tenantId)).toBe(true);
  });
});

describe('PRC-M608 fail-closed when no verified actor is present', () => {
  it('returns 401 for a create with no verified sub and writes no audit row', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/policies',
      headers: { 'x-roles': 'tenant_admin' }, // no x-sub -> no verified actor
      payload: tenantPolicyBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('ACTOR_REQUIRED');
    expect(port.events).toHaveLength(0);
  });
});
