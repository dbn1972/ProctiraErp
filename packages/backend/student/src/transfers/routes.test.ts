import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryEnrollmentRepository } from '../enrollment/in-memory-enrollment-repository.js';
import { MemoryTransferWorkflowStore } from './memory-store.js';
import { registerTransferWorkflowRoutes } from './routes.js';
import { TransferWorkflowService } from './service.js';

const TENANT_A = '00000000-0000-4000-8000-0000000000a1';
const TENANT_B = '00000000-0000-4000-8000-0000000000b2';
const STUDENT = '00000000-0000-4000-8000-00000000c001';
const SOURCE_ENROLLMENT = '00000000-0000-4000-8000-00000000c011';
const SOURCE_SCHOOL = '00000000-0000-4000-8000-00000000c021';
const DEST_SCHOOL = '00000000-0000-4000-8000-00000000c022';
const GRADE = '00000000-0000-4000-8000-00000000c031';
const CLASS_ID = '00000000-0000-4000-8000-00000000c041';
const PERIOD = '00000000-0000-4000-8000-00000000c051';
const CBSE = '00000000-0000-4000-8000-00000000c061';
const ICSE = '00000000-0000-4000-8000-00000000c062';

function user(roleId: string, institutionId?: string) {
  return {
    sub: `${roleId}-user`,
    displayName: roleId,
    roles: [{ roleId, roleName: roleId, institutionId }],
    institutions: institutionId ? [institutionId] : [],
  };
}

describe('transfer workflow routes', () => {
  let app: FastifyInstance;
  let store: MemoryTransferWorkflowStore;
  let tenantId = TENANT_A;
  let actor = user('admin');

  beforeEach(async () => {
    store = new MemoryTransferWorkflowStore(new InMemoryEnrollmentRepository());
    const service = new TransferWorkflowService(store);
    tenantId = TENANT_A;
    actor = user('admin');
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
      (request as unknown as { user: unknown }).user = actor;
    });
    await registerTransferWorkflowRoutes(app, { service });
    await app.ready();
  });

  function createBody() {
    return {
      studentId: STUDENT,
      sourceEnrollmentId: SOURCE_ENROLLMENT,
      sourceInstitutionId: SOURCE_SCHOOL,
      destinationInstitutionId: DEST_SCHOOL,
      destinationGradeId: GRADE,
      destinationClassId: CLASS_ID,
      academicPeriodId: PERIOD,
      reason: 'Family relocation',
      transferDate: '2026-09-01',
      sourceBoardId: CBSE,
      destinationBoardId: ICSE,
      sourceBoardCode: 'CBSE',
      destinationBoardCode: 'ICSE',
      studentName: 'Aarav Mehta',
      sourceInstitutionName: 'Sunrise Public School',
      destinationInstitutionName: 'Proctira Academy',
    };
  }

  it('runs submit → review → approve → complete and rejects a second transfer', async () => {
    const created = await app.inject({ method: 'POST', url: '/transfers', payload: createBody() });
    expect(created.statusCode).toBe(201);
    const id = created.json().transferId as string;
    expect(created.json().studentName).toBe('Aarav Mehta');
    expect(created.json().approvals.length).toBeGreaterThan(0);

    const submit = await app.inject({ method: 'POST', url: `/transfers/${id}/submit`, payload: {} });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().workflowStatus).toBe('SUBMITTED');

    const review = await app.inject({ method: 'POST', url: `/transfers/${id}/review`, payload: {} });
    expect(review.statusCode).toBe(200);
    expect(review.json().workflowStatus).toBe('UNDER_REVIEW');

    const blocked = await app.inject({ method: 'POST', url: `/transfers/${id}/approve`, payload: {} });
    expect(blocked.statusCode).toBe(422);

    actor = user('registrar', SOURCE_SCHOOL);
    const registrarDenied = await app.inject({
      method: 'POST',
      url: '/transfers/equivalency',
      payload: {
        sourceBoardId: CBSE,
        targetBoardId: ICSE,
        sourceGradeCode: 'G9',
        targetGradeCode: 'G9',
        sourceSubject: 'Mathematics',
        targetSubject: 'Mathematics',
        sourceMarksMax: 100,
        targetMarksMax: 100,
        creditFactor: 1,
        mappingStatus: 'mapped',
      },
    });
    expect(registrarDenied.statusCode).toBe(403);

    actor = user('admin');
    const rule = await app.inject({
      method: 'POST',
      url: '/transfers/equivalency',
      payload: {
        sourceBoardId: CBSE,
        targetBoardId: ICSE,
        sourceGradeCode: 'G9',
        targetGradeCode: 'G9',
        sourceSubject: 'Mathematics',
        targetSubject: 'Mathematics',
        sourceMarksMax: 100,
        targetMarksMax: 100,
        creditFactor: 1,
        mappingStatus: 'mapped',
      },
    });
    expect(rule.statusCode).toBe(201);

    const approved = await app.inject({
      method: 'POST',
      url: `/transfers/${id}/approve`,
      payload: { comment: 'Equivalency checked' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().workflowStatus).toBe('APPROVED');
    expect(approved.json().equivalency[0].sourceSubject).toContain('Mathematics');

    const completed = await app.inject({ method: 'POST', url: `/transfers/${id}/complete`, payload: {} });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().workflowStatus).toBe('COMPLETED');
    expect(completed.json().destinationEnrollmentId).toBeTruthy();
    expect(store.enrollmentStatus(TENANT_A, SOURCE_ENROLLMENT)).toBe('TRANSFERRED');

    const again = await app.inject({ method: 'POST', url: `/transfers/${id}/complete`, payload: {} });
    expect(again.statusCode).toBe(409);

    const rejected = await app.inject({ method: 'POST', url: '/transfers', payload: createBody() });
    const rejectId = rejected.json().transferId as string;
    await app.inject({ method: 'POST', url: `/transfers/${rejectId}/submit`, payload: {} });
    await app.inject({ method: 'POST', url: `/transfers/${rejectId}/review`, payload: {} });
    const missingComment = await app.inject({
      method: 'POST',
      url: `/transfers/${rejectId}/reject`,
      payload: {},
    });
    expect(missingComment.statusCode).toBe(400);
    const rejection = await app.inject({
      method: 'POST',
      url: `/transfers/${rejectId}/reject`,
      payload: { comment: 'No seat in the section' },
    });
    expect(rejection.statusCode).toBe(200);
    expect(rejection.json().workflowStatus).toBe('REJECTED');
    expect(rejection.json().timeline.some((event: { comment: string }) => event.comment.includes('No seat'))).toBe(true);
  });

  it('hides another tenant transfer and blocks the source principal from approving', async () => {
    const created = await app.inject({ method: 'POST', url: '/transfers', payload: createBody() });
    const id = created.json().transferId as string;

    tenantId = TENANT_B;
    const hidden = await app.inject({ method: 'POST', url: `/transfers/${id}/submit`, payload: {} });
    expect(hidden.statusCode).toBe(404);
    const otherQueue = await app.inject({ method: 'GET', url: '/transfers/pending' });
    expect(JSON.stringify(otherQueue.json())).not.toContain('Aarav Mehta');

    tenantId = TENANT_A;
    actor = user('principal', SOURCE_SCHOOL);
    await app.inject({ method: 'POST', url: `/transfers/${id}/submit`, payload: {} });
    const review = await app.inject({ method: 'POST', url: `/transfers/${id}/review`, payload: {} });
    expect(review.statusCode).toBe(403);

    actor = user('teacher');
    const pending = await app.inject({ method: 'GET', url: '/transfers/pending' });
    expect(pending.statusCode).toBe(200);
    const names = JSON.stringify(pending.json());
    expect(names).toContain('Aarav Mehta');
    expect(names).not.toContain(TENANT_B);
  });
});
