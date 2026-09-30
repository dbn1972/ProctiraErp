/**
 * PRC-L305 — result routes bind their RBAC action per route definition
 * (not by URL substring). With an update-only role: marks allowed, publish
 * and analysis 403, and a crafted query string cannot change the action.
 */
import { ForbiddenError } from '@proctira/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./examination-access.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./examination-access.js')>();
  return {
    ...actual,
    // Simulated future divergence: 'marks_clerk' may update but never publish.
    assertExaminationAccess: (roles: unknown, action: string) => {
      const list = Array.isArray(roles) ? roles : [];
      if (list.includes('marks_clerk') && action === 'exam.update') return;
      throw new ForbiddenError(`Denied: ${action}`);
    },
  };
});

const { registerResultRoutes } = await import('./result-routes.js');

const EXAM = '55555555-5555-4555-8555-555555555555';
const STUDENT = '66666666-6666-4666-8666-666666666666';
const SUBJECT = '77777777-7777-4777-8777-777777777777';

describe('result routes per-route RBAC (PRC-L305)', () => {
  let app: FastifyInstance;
  const service = {
    recordMarks: vi.fn(async () => ({ candidateCount: 1, subjectResultCount: 1 })),
    publishResults: vi.fn(async () => ({})),
    generateAnalysis: vi.fn(async () => ({})),
  };

  beforeEach(async () => {
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      Object.assign(request, { tenantId: 'tenant-l305', user: { roles: ['marks_clerk'] } });
    });
    await registerResultRoutes(app, { resultPublicationService: service as never });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  const marksBody = {
    entries: [{ studentId: STUDENT, marks: [{ subjectId: SUBJECT, score: 10 }] }],
  };

  it('allows marks entry for an update-only role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/examinations/${EXAM}/results/marks`,
      payload: marksBody,
    });
    expect(res.statusCode).not.toBe(403);
    expect(service.recordMarks).toHaveBeenCalledOnce();
  });

  it('marks route stays exam.update even with /publish in the query string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/examinations/${EXAM}/results/marks?a=/publish`,
      payload: marksBody,
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('denies publish for an update-only role', async () => {
    const res = await app.inject({ method: 'POST', url: `/examinations/${EXAM}/results/publish` });
    expect(res.statusCode).toBe(403);
    expect(service.publishResults).not.toHaveBeenCalled();
  });

  it('denies analysis generation for an update-only role', async () => {
    const res = await app.inject({ method: 'POST', url: `/examinations/${EXAM}/results/analysis` });
    expect(res.statusCode).toBe(403);
    expect(service.generateAnalysis).not.toHaveBeenCalled();
  });
});
