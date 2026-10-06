/**
 * PRC-H066 — grade writes are scoped to the section.
 *
 * Acceptance (docs/audits/gap-analysis/gaps/gradebook.md):
 *  - teacher not assigned to section -> 403 on upsert/submit
 *  - student not enrolled in section -> 422
 *  - cross-school (school-bound) caller -> 403
 *  - assigned teacher and registrar/principal-class roles succeed
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryGradebookExtrasStore } from './extras-store.js';
import { gradebookPlugin, type GradebookPluginOptions } from './gradebook-plugin.js';
import type { GradebookRepository } from './gradebook-repository.js';
import { GradebookService } from './gradebook-service.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INST_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INST_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SEC_A = '44444444-4444-4444-8444-44444444000a';
const SEC_B = '44444444-4444-4444-8444-44444444000b';
const STUDENT_A = '33333333-3333-4333-8333-33333333000a';
const STUDENT_B = '33333333-3333-4333-8333-33333333000b';
const STUDENT_UNENROLLED = '33333333-3333-4333-8333-33333333000c';
const TEACHER_A = 'teacher-a';
const TEACHER_OTHER = 'teacher-other';

type TestUser = {
  tenantId: string;
  id: string;
  roles: unknown[];
  institutions?: string[];
};

function seededRepo(): InMemoryGradebookRepository {
  const repo = new InMemoryGradebookRepository();
  for (const [id, institutionId, code] of [
    [SEC_A, INST_A, '10-A'],
    [SEC_B, INST_B, '10-B'],
  ] as const) {
    repo.seedSection({
      id,
      tenantId: TENANT,
      institutionId,
      academicPeriodId: '77777777-7777-4777-8777-777777777777',
      code,
      name: `Class ${code}`,
      status: 'PUBLISHED',
    });
  }
  repo.seedSectionTeacher({
    tenantId: TENANT,
    sectionId: SEC_A,
    staffId: 'staff-teacher-a',
    principalId: TEACHER_A,
  });
  repo.seedSectionEnrollment({ tenantId: TENANT, sectionId: SEC_A, studentId: STUDENT_A });
  repo.seedSectionEnrollment({ tenantId: TENANT, sectionId: SEC_B, studentId: STUDENT_B });
  return repo;
}

describe('PRC-H066 grade-write section scope (routes)', () => {
  let app: FastifyInstance;
  let repo: InMemoryGradebookRepository;
  let actor: TestUser;

  async function build(extra: Partial<GradebookPluginOptions> = {}) {
    repo = seededRepo();
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { user: TestUser }).user = actor;
    });
    await app.register(gradebookPlugin, {
      repository: repo,
      extras: new InMemoryGradebookExtrasStore(),
      prefix: '/gradebook',
      ...extra,
    });
    await app.ready();
  }

  function as(id: string, roles: unknown[], institutions?: string[]) {
    actor = { tenantId: TENANT, id, roles, ...(institutions ? { institutions } : {}) };
  }

  function put(payload: Record<string, unknown>) {
    return app.inject({
      method: 'PUT',
      url: '/gradebook/entries',
      payload: { assessmentCode: 'MATH', numericScore: 80, ...payload },
    });
  }

  function transition(id: string, action: string) {
    return app.inject({
      method: 'POST',
      url: `/gradebook/entries/${id}/transition`,
      payload: { action },
    });
  }

  beforeEach(async () => {
    as(TEACHER_A, ['teacher']);
    await build();
  });

  afterEach(async () => {
    await app.close();
  });

  it('assigned teacher can enter and submit a grade for an enrolled student', async () => {
    const res = await put({ sectionId: SEC_A, studentId: STUDENT_A });
    expect(res.statusCode, res.body).toBe(200);
    const submitted = await transition(res.json().id, 'submit');
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json().metadata.workflowStatus).toBe('SUBMITTED');
  });

  it('teacher not assigned to the section gets 403 on upsert', async () => {
    const res = await put({ sectionId: SEC_B, studentId: STUDENT_B });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(await repo.listGradeEntries(TENANT, { sectionId: SEC_B })).toHaveLength(0);
  });

  it('teacher not assigned to the section gets 403 on submit', async () => {
    as('principal-1', ['principal']);
    const created = await put({ sectionId: SEC_A, studentId: STUDENT_A });
    expect(created.statusCode, created.body).toBe(200);
    as(TEACHER_OTHER, ['teacher']);
    const res = await transition(created.json().id, 'submit');
    expect(res.statusCode).toBe(403);
  });

  it('student not enrolled in the section gets 422', async () => {
    const res = await put({ sectionId: SEC_A, studentId: STUDENT_UNENROLLED });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'BUSINESS_RULE_ERROR' });
  });

  it('student enrolled in another section gets 422 even for a principal', async () => {
    as('principal-1', ['principal']);
    const res = await put({ sectionId: SEC_A, studentId: STUDENT_B });
    expect(res.statusCode).toBe(422);
  });

  it('requires sectionId on grade entry (400)', async () => {
    const res = await put({ studentId: STUDENT_A });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('unknown section is 404', async () => {
    const res = await put({
      sectionId: '44444444-4444-4444-8444-44444444ffff',
      studentId: STUDENT_A,
    });
    expect(res.statusCode).toBe(404);
  });

  it('roleName alone does not lift a caller out of the assignment requirement', async () => {
    // grade.entry passes via roleName, but institution-wide scope needs the roleId.
    as(TEACHER_OTHER, [{ roleName: 'principal' }]);
    const res = await put({ sectionId: SEC_B, studentId: STUDENT_B });
    expect(res.statusCode).toBe(403);
  });

  it('principal-class role writes any section of its institution scope without assignment', async () => {
    as('principal-1', [{ roleId: 'principal', roleName: 'Principal' }], [INST_B]);
    const res = await put({ sectionId: SEC_B, studentId: STUDENT_B });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('cross-school: school-bound principal is 403 on another school section', async () => {
    as('principal-1', ['principal'], [INST_A]);
    const res = await put({ sectionId: SEC_B, studentId: STUDENT_B });
    expect(res.statusCode).toBe(403);
  });

  it('registrar moderates any section; school-bound registrar is 403 cross-school', async () => {
    as('principal-1', ['principal']);
    const created = await put({ sectionId: SEC_B, studentId: STUDENT_B });
    expect(created.statusCode, created.body).toBe(200);
    expect((await transition(created.json().id, 'submit')).statusCode).toBe(200);

    as('registrar-a', ['registrar'], [INST_A]);
    expect((await transition(created.json().id, 'approve')).statusCode).toBe(403);

    as('registrar-1', ['registrar']);
    const approved = await transition(created.json().id, 'approve');
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().metadata.workflowStatus).toBe('APPROVED');
  });

  it('bulk submit with one out-of-scope entry is 403 and applies nothing', async () => {
    as('principal-1', ['principal']);
    const inScope = (await put({ sectionId: SEC_A, studentId: STUDENT_A })).json().id as string;
    const outOfScope = (await put({ sectionId: SEC_B, studentId: STUDENT_B })).json().id as string;

    as(TEACHER_A, ['teacher']);
    const res = await app.inject({
      method: 'POST',
      url: '/gradebook/entries/bulk-transition',
      payload: { ids: [inScope, outOfScope], action: 'submit' },
    });
    expect(res.statusCode).toBe(403);
    const untouched = await repo.getGradeEntry(TENANT, inScope);
    expect(untouched?.metadata.workflowStatus).toBe('DRAFT');

    const ok = await app.inject({
      method: 'POST',
      url: '/gradebook/entries/bulk-transition',
      payload: { ids: [inScope], action: 'submit' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('assigned teacher without an active staff assignment at the school is 403', async () => {
    await app.close();
    const calls: Array<[string, string, string]> = [];
    await build({
      staffHasActiveAssignmentAt: async (tenantId, staffId, institutionId) => {
        calls.push([tenantId, staffId, institutionId]);
        return false;
      },
    });
    const res = await put({ sectionId: SEC_A, studentId: STUDENT_A });
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([[TENANT, 'staff-teacher-a', INST_A]]);
  });

  it('assigned teacher with an active staff assignment at the school succeeds', async () => {
    await app.close();
    await build({
      staffHasActiveAssignmentAt: async (_tenantId, staffId, institutionId) =>
        staffId === 'staff-teacher-a' && institutionId === INST_A,
    });
    const res = await put({ sectionId: SEC_A, studentId: STUDENT_A });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('PRC-H066 fail-closed when membership lookup is unavailable', () => {
  /** A repository that does not implement the membership port. */
  function repoWithoutMembership(): GradebookRepository {
    const inner = seededRepo();
    return new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'listTeacherStaffIdsForSection' || prop === 'isStudentEnrolledInSection') {
          return undefined;
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as GradebookRepository;
  }

  const teacher = { id: TEACHER_OTHER, roles: ['teacher'] };
  const input = { sectionId: SEC_B, studentId: STUDENT_B, numericScore: 70 };

  it('production-like env returns 503 for grade writes', async () => {
    const service = new GradebookService(repoWithoutMembership(), undefined, {
      nodeEnv: 'production',
    });
    await expect(service.upsertGradeEntry(TENANT, input, teacher)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('unset NODE_ENV is production-like and fails closed', async () => {
    const service = new GradebookService(repoWithoutMembership(), undefined, {
      nodeEnv: undefined,
    });
    await expect(service.upsertGradeEntry(TENANT, input, teacher)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it('with membership configured, an unassigned teacher is 403 in any env', async () => {
    const repo = seededRepo();
    const service = new GradebookService(repo, undefined, { sectionMembership: repo });
    await expect(service.upsertGradeEntry(TENANT, input, teacher)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
