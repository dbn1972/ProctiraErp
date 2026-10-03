/**
 * PRC-M323: every privacy mutation yields an audit row with the real actor, the caller ip and
 * before/after status; a request without an authenticated subject is rejected with 401.
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { CompositeCorrectionApplier } from './correction-applier.js';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { RecordingPrivacyAuditPort } from './privacy-audit.js';
import { PrivacyService } from './privacy-service.js';
import { registerPrivacyRoutes } from './routes.js';

const TENANT = 'tenant-a';
const IP = '203.0.113.7';

async function buildApp(opts: { withUser?: boolean } = {}) {
  const audit = new RecordingPrivacyAuditPort();
  const store: Record<string, string> = { email: 'old@example.com' };
  const service = new PrivacyService(new InMemoryPrivacyRepository(), {
    audit,
    anonymizer: { anonymize: async () => ({ fieldsTouched: ['email'] }) },
    correctionApplier: new CompositeCorrectionApplier({
      student: {
        allowedFieldPaths: () => ['email'],
        readCurrentValue: async ({ fieldPath }) => store[fieldPath] ?? null,
        applyValue: async ({ fieldPath, value }) => {
          store[fieldPath] = value;
        },
      },
    }),
  });
  const app = Fastify({ trustProxy: true });
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT;
    if (opts.withUser !== false) {
      (request as unknown as { user: { sub: string } }).user = { sub: 'dpo-1' };
    }
  });
  await registerPrivacyRoutes(app, { privacyService: service });
  return { app, audit };
}

const headers = { 'x-forwarded-for': IP };

describe('privacy HTTP audit attribution (PRC-M323)', () => {
  it('erasure + correction mutations each audit actor, ip and before/after status', async () => {
    const { app, audit } = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/privacy/erasure-requests',
      headers,
      payload: { subjectType: 'student', subjectId: 'stu-1' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    for (const status of ['under_review', 'approved']) {
      const t = await app.inject({
        method: 'POST',
        url: `/privacy/erasure-requests/${id}/transition`,
        headers,
        payload: { status },
      });
      expect(t.statusCode).toBe(200);
    }
    const exec = await app.inject({
      method: 'POST',
      url: `/privacy/erasure-requests/${id}/execute`,
      headers,
    });
    expect(exec.statusCode).toBe(200);

    const corr = await app.inject({
      method: 'POST',
      url: '/privacy/correction-requests',
      headers,
      payload: {
        subjectType: 'student',
        subjectId: 'stu-1',
        fieldPath: 'email',
        requestedValue: 'new@example.com',
      },
    });
    expect(corr.statusCode).toBe(201);
    const cid = corr.json().id as string;
    for (const status of ['under_review', 'approved']) {
      const t = await app.inject({
        method: 'POST',
        url: `/privacy/correction-requests/${cid}/transition`,
        headers,
        payload: { status },
      });
      expect(t.statusCode).toBe(200);
    }
    const applied = await app.inject({
      method: 'POST',
      url: `/privacy/correction-requests/${cid}/apply`,
      headers,
    });
    expect(applied.statusCode).toBe(200);

    const erasureEvents = audit.events.filter(
      (e) => e.entityType === 'privacy_erasure' && e.entityId === id,
    );
    expect(erasureEvents.map((e) => e.afterValues?.status)).toEqual(
      expect.arrayContaining(['requested', 'under_review', 'approved', 'in_progress']),
    );
    expect(
      erasureEvents.find((e) => e.afterValues?.status === 'approved')?.beforeValues,
    ).toEqual({ status: 'under_review' });
    const correctionEvents = audit.events.filter((e) => e.entityId === cid);
    expect(correctionEvents.map((e) => e.afterValues?.status)).toEqual([
      'requested',
      'under_review',
      'approved',
      'applied',
    ]);
    // Request-driven events carry the real actor and caller ip.
    for (const e of [...correctionEvents, ...erasureEvents.filter((x) => x.operation === 'CREATE')]) {
      expect(e.userId).toBe('dpo-1');
      expect(e.ipAddress).toBe(IP);
    }
    for (const e of erasureEvents.filter((x) => x.afterValues?.status !== 'completed')) {
      expect(e.userId).toBe('dpo-1');
      expect(e.ipAddress).toBe(IP);
    }
    await app.close();
  });

  it.each([
    ['POST', '/privacy/legal-holds', { scope: 'tenant', reason: 'x' }],
    ['POST', '/privacy/erasure-requests', { subjectType: 'student', subjectId: 's' }],
    [
      'POST',
      '/privacy/correction-requests',
      { subjectType: 'student', subjectId: 's', fieldPath: 'email', requestedValue: 'v' },
    ],
    ['POST', '/privacy/tenant-offboard', { reason: 'x' }],
    ['POST', '/privacy/erasure-requests/5a5a5a5a-0000-4000-8000-000000000001/execute', {}],
  ] as const)('%s %s without an authenticated user returns 401', async (method, url, payload) => {
    const { app, audit } = await buildApp({ withUser: false });
    const res = await app.inject({ method, url, payload });
    expect(res.statusCode).toBe(401);
    expect(audit.events).toHaveLength(0);
    await app.close();
  });
});
