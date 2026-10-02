/**
 * PRC-H030 — application subject is resolved server-side; placeholder / foreign ids rejected.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryScholarshipDocumentBlobStore } from './document-blob-store.js';
import { InMemoryScholarshipDocumentStore } from './document-store.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { scholarshipPlugin } from './scholarship-plugin.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const STUDENT = '00000000-0000-4000-8000-0000000000c1';
const SIBLING = '00000000-0000-4000-8000-0000000000c2';
const FOREIGN_STUDENT = '00000000-0000-4000-8000-0000000000f9';
const INSTITUTION = '00000000-0000-4000-8000-0000000000d1';
const NIL = '00000000-0000-4000-8000-000000000000';

interface User {
  sub: string;
  roles: unknown;
  studentId?: string;
  linkedStudentIds?: string[];
}

const staff: User = { sub: 'staff-1', roles: ['bursar'] };
const student: User = {
  sub: STUDENT,
  roles: [{ roleName: 'student', institutionId: INSTITUTION }],
  studentId: STUDENT,
};

let app: FastifyInstance | undefined;
let currentUser: User = staff;

async function buildApp(repository: InMemoryScholarshipRepository) {
  const instance = Fastify({ logger: false });
  instance.decorateRequest('tenantId', '');
  instance.addHook('onRequest', async (request) => {
    (request as { tenantId?: string }).tenantId = TENANT;
    (request as { user?: User }).user = currentUser;
  });
  await instance.register(scholarshipPlugin, {
    repository,
    prefix: '/scholarships',
    documentStore: new InMemoryScholarshipDocumentStore(),
    documentBlobs: new InMemoryScholarshipDocumentBlobStore(),
    // Students of TENANT; FOREIGN_STUDENT belongs to another tenant.
    applicantExists: async (tenantId, id) => tenantId === TENANT && [STUDENT, SIBLING].includes(id),
  });
  await instance.ready();
  return instance;
}

async function openProgram(instance: FastifyInstance, name = 'Need grant') {
  currentUser = staff;
  const created = await instance.inject({
    method: 'POST',
    url: '/scholarships/programs',
    payload: {
      name,
      applicationStartDate: '2020-01-01',
      applicationEndDate: '2099-12-31',
      totalSlots: 5,
      amountPerRecipient: 1000,
      eligibility: { requiredDocuments: [] },
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id as string;
  const opened = await instance.inject({
    method: 'PUT',
    url: `/scholarships/programs/${id}`,
    payload: { status: 'open' },
  });
  expect(opened.statusCode).toBe(200);
  return id;
}

function draftBody(programId: string, extra: Record<string, unknown> = {}) {
  return {
    programId,
    academicRecords: [{ institutionName: 'Sunrise', educationLevel: 'secondary', gpa: 3.1 }],
    financialInfo: { familyIncome: 1000 },
    documents: [],
    asDraft: true,
    ...extra,
  };
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  currentUser = staff;
});

describe('PRC-H030 application subject', () => {
  it('a student session creates a draft for its own student id and role institution', async () => {
    const repository = new InMemoryScholarshipRepository();
    app = await buildApp(repository);
    const programId = await openProgram(app);
    currentUser = student;
    const res = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: draftBody(programId),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().applicantId).toBe(STUDENT);
    expect(res.json().institutionId).toBe(INSTITUTION);
  });

  it('a parent with one linked child applies for that child', async () => {
    const repository = new InMemoryScholarshipRepository();
    app = await buildApp(repository);
    const programId = await openProgram(app);
    currentUser = {
      sub: 'parent-1',
      roles: [{ roleName: 'parent', institutionId: INSTITUTION }],
      linkedStudentIds: [SIBLING],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: draftBody(programId),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().applicantId).toBe(SIBLING);
  });

  it('rejects the nil-UUID placeholder with 400 and creates nothing', async () => {
    const repository = new InMemoryScholarshipRepository();
    app = await buildApp(repository);
    const programId = await openProgram(app);
    const res = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: draftBody(programId, { applicantId: NIL, institutionId: NIL }),
    });
    expect(res.statusCode).toBe(400);
    const list = await repository.listApplications(TENANT, {}, { page: 1, pageSize: 10 });
    expect(list.data).toHaveLength(0);
  });

  it('rejects an applicant id that is not a student of the tenant (cross-tenant)', async () => {
    const repository = new InMemoryScholarshipRepository();
    app = await buildApp(repository);
    const programId = await openProgram(app);
    const res = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: draftBody(programId, { applicantId: FOREIGN_STUDENT, institutionId: INSTITUTION }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('asks for a student when a parent has several linked children', async () => {
    const repository = new InMemoryScholarshipRepository();
    app = await buildApp(repository);
    const programId = await openProgram(app);
    currentUser = {
      sub: 'parent-2',
      roles: [{ roleName: 'parent', institutionId: INSTITUTION }],
      linkedStudentIds: [STUDENT, SIBLING],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: draftBody(programId),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/select the student/i);
  });
});
