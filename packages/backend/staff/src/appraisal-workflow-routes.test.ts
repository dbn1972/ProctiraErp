/**
 * PRC-M376: appraisal approve/reject transitions, atomic submit, reviewer =
 * authenticated actor, and workflow-instance compensation.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAppraisalRoutes } from './appraisal-routes.js';
import { AppraisalService, type WorkflowIntegration } from './appraisal-service.js';
import {
  InMemoryAppraisalRepository,
  InMemoryAppraisalTemplateRepository,
} from './in-memory-appraisal-repository.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const APPRAISAL = '660e8400-e29b-41d4-a716-446655440001';

async function setup(opts: { roles?: string[]; sub?: string; wf?: WorkflowIntegration } = {}) {
  const repo = new InMemoryAppraisalRepository();
  await repo.create({
    id: APPRAISAL,
    tenantId: TENANT,
    staffId: '770e8400-e29b-41d4-a716-446655440002',
    templateId: '880e8400-e29b-41d4-a716-446655440003',
    appraisalDate: '2026-03-01',
    scores: [],
    totalScore: 0,
    overallComment: null,
    status: 'DRAFT',
    workflowInstanceId: null,
  });
  const service = new AppraisalService(new InMemoryAppraisalTemplateRepository(), repo, opts.wf);
  const app: FastifyInstance = Fastify();
  app.addHook('onRequest', async (request) => {
    Object.assign(request, {
      tenantId: TENANT,
      user: { roles: opts.roles ?? ['hr_officer'], sub: opts.sub },
    });
  });
  await registerAppraisalRoutes(app, { appraisalService: service });
  await app.ready();
  return { app, repo };
}

const post = (app: FastifyInstance, action: string) =>
  app.inject({ method: 'POST', url: `/staff/appraisals/${APPRAISAL}/${action}` });

describe('appraisal workflow routes (PRC-M376)', () => {
  it('submit then approve -> APPROVED', async () => {
    const { app } = await setup({ sub: 'reviewer-1' });
    expect((await post(app, 'submit')).statusCode).toBe(200);
    const res = await post(app, 'approve');
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('APPROVED');
  });

  it('reject -> REJECTED; deciding twice -> 409', async () => {
    const { app } = await setup({ sub: 'reviewer-1' });
    await post(app, 'submit');
    expect((await post(app, 'reject')).json().status).toBe('REJECTED');
    expect((await post(app, 'approve')).statusCode).toBe(409);
  });

  it('approving a DRAFT -> 409', async () => {
    const { app } = await setup({ sub: 'reviewer-1' });
    expect((await post(app, 'approve')).statusCode).toBe(409);
  });

  it('concurrent double submit creates one workflow instance; loser gets an error', async () => {
    let created = 0;
    const wf: WorkflowIntegration = {
      createInstance: async () => `wf-${++created}`,
    };
    const { app } = await setup({ sub: 'reviewer-1', wf });
    const [a, b] = await Promise.all([post(app, 'submit'), post(app, 'submit')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409].sort());
    expect(created).toBe(1);
  });

  it('workflow createInstance failure reverts to DRAFT', async () => {
    const wf: WorkflowIntegration = {
      createInstance: async () => {
        throw new Error('engine down');
      },
    };
    const { app, repo } = await setup({ sub: 'reviewer-1', wf });
    expect((await post(app, 'submit')).statusCode).toBe(500);
    expect((await repo.findById(APPRAISAL, TENANT))?.status).toBe('DRAFT');
  });

  it('non-HR role (registrar) cannot approve -> 403', async () => {
    const { app } = await setup({ roles: ['registrar'], sub: 'reviewer-1' });
    await post(app, 'submit');
    expect((await post(app, 'approve')).statusCode).toBe(403);
  });

  it('no authenticated subject -> 401', async () => {
    const { app } = await setup({});
    await post(app, 'submit');
    expect((await post(app, 'approve')).statusCode).toBe(401);
  });
});
