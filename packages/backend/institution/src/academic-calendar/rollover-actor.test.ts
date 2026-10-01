/**
 * PRC-L319 — rollover ledger, clone hooks and audit carry the JWT subject,
 * not a hard-coded "rollover" actor.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAcademicsDeps } from '../academics-factory.js';
import { InMemoryInstitutionRepository } from '../in-memory-repository.js';
import { institutionPlugin } from '../institution-plugin.js';

const TENANT = randomUUID();
const ACTOR = 'user-7f3a';

describe('PRC-L319 rollover actor attribution', () => {
  let app: FastifyInstance;
  let withUser = true;
  const recordRolloverRun = vi.fn(async () => undefined);
  const copyFeeStructures = vi.fn(async () => ({ cloned: 1, source: 1 }));
  const recordAudit = vi.fn(async () => undefined);

  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    withUser = true;
    recordRolloverRun.mockClear();
    copyFeeStructures.mockClear();
    recordAudit.mockClear();
    const repository = new InMemoryInstitutionRepository();
    app = Fastify();
    app.decorate('auditService', { recordAudit });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      if (withUser) (request as unknown as { user: { sub: string } }).user = { sub: ACTOR };
    });
    await app.register(institutionPlugin, {
      repository,
      academics: createAcademicsDeps({ institutionRepository: repository }),
      rolloverExtras: { recordRolloverRun, copyFeeStructures },
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  async function years() {
    const mk = async (code: string, start: string, end: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/academic-periods',
        payload: { name: code, code, startDate: start, endDate: end },
      });
      expect(res.statusCode).toBe(201);
      return res.json().id as string;
    };
    return {
      source: await mk('AY25', '2025-04-01', '2026-03-31'),
      target: await mk('AY26', '2026-04-01', '2027-03-31'),
    };
  }

  it('records the JWT sub on the ledger, the fee clone hook and the audit event', async () => {
    const { source, target } = await years();
    const res = await app.inject({
      method: 'POST',
      url: `/academic-periods/${source}/rollover`,
      payload: { targetPeriodId: target, dryRun: false, copyFeeStructures: true },
    });
    expect(res.statusCode).toBe(200);
    expect(recordRolloverRun).toHaveBeenCalledWith(expect.objectContaining({ actorId: ACTOR }));
    expect(copyFeeStructures).toHaveBeenCalledWith(TENANT, ACTOR, source, target, {
      dryRun: false,
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ACTOR,
        metadata: expect.objectContaining({ action: 'academic_period.rollover' }),
      }),
    );
  });

  it('does not emit an audit event for dry-runs', async () => {
    const { source, target } = await years();
    const res = await app.inject({
      method: 'POST',
      url: `/academic-periods/${source}/rollover`,
      payload: { targetPeriodId: target },
    });
    expect(res.statusCode).toBe(200);
    expect(recordRolloverRun).toHaveBeenCalledWith(expect.objectContaining({ actorId: ACTOR }));
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('returns 401 without an authenticated subject', async () => {
    const { source, target } = await years();
    withUser = false;
    const res = await app.inject({
      method: 'POST',
      url: `/academic-periods/${source}/rollover`,
      payload: { targetPeriodId: target, dryRun: false },
    });
    expect(res.statusCode).toBe(401);
    expect(recordRolloverRun).not.toHaveBeenCalled();
  });
});
