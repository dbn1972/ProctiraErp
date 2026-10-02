/**
 * PRC-H003: break-glass dual control is enforced by the gateway, not only the console.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyExpiry,
  approveRequest,
  createKeyedLock,
  createRequest,
  revokeRequest,
  type BreakGlassRow,
} from './break-glass-policy.js';
import { platformAdminUiPlugin } from './platform-admin-ui-plugin.js';

const PLATFORM_ROLES = [{ roleId: 'platform_admin', roleName: 'Platform admin', areaId: null }];
const REQUESTER = { sub: 'op-requester', email: 'requester@proctira.org' };
const APPROVER = { sub: 'op-approver', email: 'approver@proctira.org' };

const validBody = {
  targetTenantId: 'tnt_002',
  scope: 'read',
  justification: 'Customer export job failing; need to read failed job logs.',
  useCase: 'Production incident triage',
  durationMinutes: 30,
};

describe('break-glass policy', () => {
  const t0 = new Date('2026-01-01T10:00:00Z');

  it('takes the requester from the actor, never the body', () => {
    const result = createRequest(
      { ...validBody, requester: 'someone-else@x' },
      REQUESTER,
      t0,
      'bg_1',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.requesterSub).toBe('op-requester');
    expect(result.row.requester).toBe('requester@proctira.org');
  });

  it('rejects out-of-range durations and unknown scopes', () => {
    expect(createRequest({ ...validBody, durationMinutes: 241 }, REQUESTER, t0, 'x').ok).toBe(
      false,
    );
    expect(createRequest({ ...validBody, durationMinutes: 0 }, REQUESTER, t0, 'x').ok).toBe(false);
    expect(createRequest({ ...validBody, scope: 'root' }, REQUESTER, t0, 'x').ok).toBe(false);
  });

  it('forbids self-approval, including legacy rows matched by email', () => {
    const created = createRequest(validBody, REQUESTER, t0, 'bg_1');
    if (!created.ok) throw new Error('setup');
    const self = approveRequest(created.row, REQUESTER, t0);
    expect(self).toMatchObject({ ok: false, statusCode: 403 });

    // Same person under a second subject (same email) is still the requester.
    expect(
      approveRequest(created.row, { sub: 'other-sub', email: 'REQUESTER@proctira.org' }, t0),
    ).toMatchObject({ ok: false, statusCode: 403 });
  });

  it('refuses to approve legacy rows without a verified requester subject', () => {
    const created = createRequest(validBody, REQUESTER, t0, 'bg_1');
    if (!created.ok) throw new Error('setup');
    const legacy: BreakGlassRow = { ...created.row, requesterSub: undefined };
    // Even an approver with no email claim cannot approve it.
    expect(approveRequest(legacy, { sub: 'op-approver' }, t0)).toMatchObject({
      ok: false,
      statusCode: 409,
      code: 'RESUBMIT_REQUIRED',
    });
  });

  it('does not honour legacy active grants that have no approver subject', () => {
    const legacyActive: BreakGlassRow = {
      id: 'bg_old',
      requester: 'someone@proctira.org',
      targetTenantId: 'tnt_002',
      scope: 'admin',
      justification: 'x'.repeat(30),
      useCase: 'Production incident triage',
      durationMinutes: 10_000_000,
      status: 'active',
      createdAt: t0.toISOString(),
      approver: 'security@proctira.org',
      expiresAt: new Date(t0.getTime() + 10_000_000 * 60_000).toISOString(),
    };
    expect(applyExpiry(legacyActive, t0).status).toBe('expired');
  });

  it('expires active grants lazily and revoke closes the window immediately', () => {
    const created = createRequest(validBody, REQUESTER, t0, 'bg_1');
    if (!created.ok) throw new Error('setup');
    const approved = approveRequest(created.row, APPROVER, t0);
    if (!approved.ok) throw new Error('setup');
    expect(approved.row.approverSub).toBe('op-approver');
    expect(applyExpiry(approved.row, new Date(t0.getTime() + 29 * 60_000)).status).toBe('active');
    expect(applyExpiry(approved.row, new Date(t0.getTime() + 30 * 60_000)).status).toBe('expired');

    const at = new Date(t0.getTime() + 5 * 60_000);
    const revoked = revokeRequest(approved.row, APPROVER, at, 'done');
    expect(revoked.ok && revoked.row.status).toBe('revoked');
    expect(revoked.ok && Date.parse(revoked.row.expiresAt!) <= at.getTime()).toBe(true);
  });
});

describe('createKeyedLock', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('serializes read-check-write on the same key so only one decision wins', async () => {
    const lock = createKeyedLock();
    let status = 'pending_approval';
    const decide = (next: string) =>
      lock('bg_1', async () => {
        const seen = status; // read
        await tick(); // store latency lets the other call interleave without the lock
        if (seen !== 'pending_approval') return 409;
        status = next; // write
        return 200;
      });
    const results = await Promise.all([decide('active'), decide('denied')]);
    expect(results.sort()).toEqual([200, 409]);
    expect(status).toBe('active');
  });

  it('keeps running after a failed call and does not block other keys', async () => {
    const lock = createKeyedLock();
    await expect(lock('a', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(lock('a', async () => 'next')).resolves.toBe('next');
    const order: string[] = [];
    await Promise.all([
      lock('a', async () => {
        await tick();
        order.push('a');
      }),
      lock('b', async () => {
        order.push('b');
      }),
    ]);
    expect(order).toEqual(['b', 'a']);
  });
});

describe('break-glass routes (gateway)', () => {
  let app: FastifyInstance;
  let actor: { sub: string; email: string } = REQUESTER;

  beforeEach(async () => {
    actor = REQUESTER;
    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { user: unknown }).user = { ...actor, roles: PLATFORM_ROLES };
    });
    await app.register(platformAdminUiPlugin);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function create() {
    actor = REQUESTER;
    const res = await app.inject({
      method: 'POST',
      url: '/break-glass',
      payload: { ...validBody, requester: 'forged@evil.test' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as BreakGlassRow;
  }

  it('records the JWT operator as requester, ignoring a body requester', async () => {
    const row = await create();
    expect(row.requester).toBe('requester@proctira.org');
    expect(row.requesterSub).toBe('op-requester');
  });

  it('returns 403 when the requester approves their own request', async () => {
    const row = await create();
    actor = REQUESTER;
    const res = await app.inject({ method: 'POST', url: `/break-glass/${row.id}/approve` });
    expect(res.statusCode).toBe(403);
  });

  it('records the JWT approver and returns 409 when approving a denied request', async () => {
    const row = await create();
    actor = APPROVER;
    const denied = await app.inject({
      method: 'POST',
      url: `/break-glass/${row.id}/deny`,
      payload: { reason: 'not justified' },
    });
    expect(denied.statusCode).toBe(200);
    const res = await app.inject({ method: 'POST', url: `/break-glass/${row.id}/approve` });
    expect(res.statusCode).toBe(409);

    const other = await create();
    actor = APPROVER;
    const ok = await app.inject({ method: 'POST', url: `/break-glass/${other.id}/approve` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().approver).toBe('approver@proctira.org');
    expect(ok.json().approverSub).toBe('op-approver');
  });

  it('returns 401 when the token has no subject', async () => {
    actor = { sub: '', email: 'x@proctira.org' };
    const res = await app.inject({ method: 'POST', url: '/break-glass', payload: validBody });
    expect(res.statusCode).toBe(401);
  });

  it('serializes concurrent approve and deny: exactly one decision wins', async () => {
    const row = await create();
    actor = APPROVER;
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/break-glass/${row.id}/approve` }),
      app.inject({ method: 'POST', url: `/break-glass/${row.id}/deny`, payload: { reason: 'no' } }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const winner = a.statusCode === 200 ? a.json() : b.json();
    const stored = (await app.inject({ method: 'GET', url: `/break-glass/${row.id}` })).json();
    expect(stored.status).toBe(winner.status);
  });

  it('revoke on an active grant sets status revoked and expiresAt <= now', async () => {
    const row = await create();
    actor = APPROVER;
    await app.inject({ method: 'POST', url: `/break-glass/${row.id}/approve` });
    const before = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: `/break-glass/${row.id}/revoke`,
      payload: { reason: 'incident closed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('revoked');
    expect(Date.parse(res.json().expiresAt)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(res.json().expiresAt)).toBeGreaterThanOrEqual(before - 1000);

    const again = await app.inject({ method: 'POST', url: `/break-glass/${row.id}/revoke` });
    expect(again.statusCode).toBe(409);
    const fetched = await app.inject({ method: 'GET', url: `/break-glass/${row.id}` });
    expect(fetched.json().status).toBe('revoked');
  });
});
