/**
 * G-717: appraisal + training routes are mounted by the staff plugin, and the
 * Postgres stores persist with tenant isolation (live when DATABASE_URL set).
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  InMemoryAppraisalRepository,
  InMemoryAppraisalTemplateRepository,
} from './in-memory-appraisal-repository.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import {
  InMemoryCertificationRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
} from './in-memory-training-repository.js';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { PgAppraisalRepository, PgAppraisalTemplateRepository } from './pg-appraisal-repository.js';
import {
  PgCertificationRepository,
  PgTrainingAttendanceRepository,
  PgTrainingProgramRepository,
  PgTrainingSessionRepository,
} from './pg-training-repository.js';
import { staffPlugin } from './staff-plugin.js';

const pool = getSharedPgPool();

describe('staffPlugin mounts appraisal + training routes (G-717)', () => {
  let app: FastifyInstance;
  const tenantId = randomUUID();

  beforeEach(async () => {
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
    });
    await app.register(staffPlugin, {
      repository: new InMemoryStaffRepository(),
      leaveRepository: new InMemoryStaffLeaveRepository(),
      appraisalRepositories: {
        templateRepository: new InMemoryAppraisalTemplateRepository(),
        appraisalRepository: new InMemoryAppraisalRepository(),
      },
      trainingRepositories: {
        programRepository: new InMemoryTrainingProgramRepository(),
        sessionRepository: new InMemoryTrainingSessionRepository(),
        attendanceRepository: new InMemoryTrainingAttendanceRepository(),
        certificationRepository: new InMemoryCertificationRepository(),
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates and lists appraisal templates via /staff/appraisals/templates', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/staff/appraisals/templates',
      payload: {
        name: 'Annual review',
        academicPeriodId: randomUUID(),
        criteria: [
          { name: 'Teaching', weight: 60, maxScore: 10 },
          { name: 'Collaboration', weight: 40, maxScore: 10 },
        ],
        scoreMin: 0,
        scoreMax: 100,
      },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/staff/appraisals/templates' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);
    expect(app.hasDecorator('staffAppraisalService')).toBe(true);
  });

  it('creates a training program via /staff/training/programs', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/staff/training/programs',
      payload: { name: 'Safeguarding', startDate: '2026-01-10', endDate: '2026-01-12' },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/staff/training/programs' });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);
    expect(app.hasDecorator('staffTrainingService')).toBe(true);
  });
});

describe('Pg appraisal + training repositories (live)', () => {
  it.skipIf(!pool)('persists templates/appraisals with RLS isolation', async () => {
    const templates = new PgAppraisalTemplateRepository(pool!);
    const appraisals = new PgAppraisalRepository(pool!);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const staffId = randomUUID();

    const template = await templates.create({
      id: randomUUID(),
      tenantId: tenantA,
      name: 'Annual',
      description: null,
      academicPeriodId: randomUUID(),
      criteria: [{ name: 'Teaching', description: null, weight: 100, maxScore: 10 }],
      scoreMin: 0,
      scoreMax: 100,
    });
    expect((await templates.findById(template.id, tenantA))?.criteria[0]?.name).toBe('Teaching');
    expect(await templates.findById(template.id, tenantB)).toBeNull();

    const appraisal = await appraisals.create({
      id: randomUUID(),
      tenantId: tenantA,
      staffId,
      templateId: template.id,
      appraisalDate: '2026-06-30',
      scores: [{ criterionName: 'Teaching', score: 9, comment: 'Strong' }],
      totalScore: 90,
      overallComment: null,
      status: 'DRAFT',
      workflowInstanceId: null,
    });
    const updated = await appraisals.update(appraisal.id, tenantA, {
      status: 'SUBMITTED',
      workflowInstanceId: 'wf-1',
      overallComment: 'Submitted for review',
    });
    expect(updated?.status).toBe('SUBMITTED');
    expect(updated?.workflowInstanceId).toBe('wf-1');
    expect(updated?.scores[0]?.score).toBe(9);
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(appraisal.updatedAt.getTime());

    const listed = await appraisals.list(
      tenantA,
      { staffId, status: 'SUBMITTED' },
      { page: 1, pageSize: 10 },
    );
    expect(listed.meta.totalItems).toBe(1);
    expect(await appraisals.list(tenantB, {}, { page: 1, pageSize: 10 })).toMatchObject({
      meta: { totalItems: 0 },
    });
    expect(await appraisals.update(appraisal.id, tenantB, { status: 'APPROVED' })).toBeNull();
  });

  it.skipIf(!pool)(
    'persists programs/sessions/attendance/certifications and finds expired ones',
    async () => {
      const programs = new PgTrainingProgramRepository(pool!);
      const sessions = new PgTrainingSessionRepository(pool!);
      const attendance = new PgTrainingAttendanceRepository(pool!);
      const certs = new PgCertificationRepository(pool!);
      const tenantId = randomUUID();
      const staffId = randomUUID();

      const program = await programs.create({
        id: randomUUID(),
        tenantId,
        name: 'First Aid',
        description: null,
        startDate: '2026-01-01',
        endDate: '2026-01-02',
        provider: 'Red Cross',
        certificationName: 'First Aid L1',
        certificationValidityDays: 365,
      });
      expect(
        (await programs.list(tenantId, 'first', { page: 1, pageSize: 5 })).meta.totalItems,
      ).toBe(1);
      expect(
        (await programs.list(tenantId, 'nomatch', { page: 1, pageSize: 5 })).meta.totalItems,
      ).toBe(0);

      const session = await sessions.create({
        id: randomUUID(),
        tenantId,
        programId: program.id,
        title: 'CPR',
        date: '2026-01-01',
        startTime: '09:00',
        endTime: '11:00',
        location: 'Hall',
        instructorName: 'Dr. A',
      });
      expect(
        (await sessions.listByProgram(tenantId, program.id, { page: 1, pageSize: 5 })).data[0]
          ?.title,
      ).toBe('CPR');

      await attendance.create({
        id: randomUUID(),
        tenantId,
        sessionId: session.id,
        staffId,
        status: 'PRESENT',
        comment: null,
      });
      expect((await attendance.findBySessionAndStaff(session.id, staffId, tenantId))?.status).toBe(
        'PRESENT',
      );
      expect(await attendance.listByStaff(tenantId, staffId)).toHaveLength(1);

      const cert = await certs.create({
        id: randomUUID(),
        tenantId,
        staffId,
        programId: program.id,
        certificationName: 'First Aid L1',
        issuedDate: '2025-01-01',
        expiryDate: '2026-01-01',
        status: 'ACTIVE',
      });
      expect(
        (await certs.findExpiredCertifications(tenantId, '2026-06-01')).map((c) => c.id),
      ).toEqual([cert.id]);
      expect(await certs.findExpiredCertifications(tenantId, '2025-06-01')).toEqual([]);
      const expired = await certs.update(cert.id, tenantId, { status: 'EXPIRED' });
      expect(expired?.status).toBe('EXPIRED');
      expect(
        (await certs.list(tenantId, { staffId, status: 'EXPIRED' }, { page: 1, pageSize: 5 })).meta
          .totalItems,
      ).toBe(1);
    },
  );
});
