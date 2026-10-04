/**
 * PRC-H031 — drafts can be updated (program, records, finances, statement) until submit.
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
const INSTITUTION = '00000000-0000-4000-8000-0000000000d1';

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

describe('PRC-H031 draft update', () => {
  it('persists a statement typed on Review and an edited GPA, then submits them', async () => {
    const repository = new InMemoryScholarshipRepository();
    app = await buildApp(repository);
    const programId = await openProgram(app);
    currentUser = student;
    const draft = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: draftBody(programId),
    });
    expect(draft.statusCode).toBe(201);
    const id = draft.json().id as string;

    const put = await app.inject({
      method: 'PUT',
      url: `/scholarships/applications/${id}`,
      payload: {
        academicRecords: [{ institutionName: 'Sunrise', educationLevel: 'secondary', gpa: 3.9 }],
        financialInfo: { familyIncome: 500 },
        personalStatement: 'I want to study engineering.',
      },
    });
    expect(put.statusCode, put.body).toBe(200);

    const submit = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${id}/submit`,
      payload: {},
    });
    expect(submit.statusCode, submit.body).toBe(200);

    const stored = await repository.findApplicationById(id, TENANT);
    expect(stored?.personalStatement).toBe('I want to study engineering.');
    expect(stored?.academicRecords[0]?.gpa).toBe(3.9);
    expect(stored?.financialInfo.familyIncome).toBe(500);
    expect(stored?.status).not.toBe('draft');
  });

  it('moves a draft to a newly selected program', async () => {
    const repository = new InMemoryScholarshipRepository();
    app = await buildApp(repository);
    const first = await openProgram(app, 'First');
    const second = await openProgram(app, 'Second');
    currentUser = student;
    const draft = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: draftBody(first),
    });
    const id = draft.json().id as string;
    const put = await app.inject({
      method: 'PUT',
      url: `/scholarships/applications/${id}`,
      payload: { programId: second },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect((await repository.findApplicationById(id, TENANT))?.programId).toBe(second);
  });

  it('refuses to edit a submitted application', async () => {
    const repository = new InMemoryScholarshipRepository();
    app = await buildApp(repository);
    const programId = await openProgram(app);
    currentUser = student;
    const draft = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: draftBody(programId),
    });
    const id = draft.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${id}/submit`,
      payload: {},
    });
    const put = await app.inject({
      method: 'PUT',
      url: `/scholarships/applications/${id}`,
      payload: { personalStatement: 'late edit' },
    });
    expect(put.statusCode).toBeGreaterThanOrEqual(400);
    expect((await repository.findApplicationById(id, TENANT))?.personalStatement).toBeNull();
  });

  it("forbids another applicant from editing someone else's draft", async () => {
    const repository = new InMemoryScholarshipRepository();
    app = await buildApp(repository);
    const programId = await openProgram(app);
    currentUser = student;
    const draft = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: draftBody(programId),
    });
    const id = draft.json().id as string;
    currentUser = {
      sub: SIBLING,
      roles: [{ roleName: 'student', institutionId: INSTITUTION }],
      studentId: SIBLING,
    };
    const put = await app.inject({
      method: 'PUT',
      url: `/scholarships/applications/${id}`,
      payload: { personalStatement: 'hijack' },
    });
    expect(put.statusCode).toBe(403);
  });
});
