import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryScholarshipDocumentBlobStore } from './document-blob-store.js';
import { InMemoryScholarshipDocumentStore } from './document-store.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { parentScholarshipPlugin } from './parent-scholarship-routes.js';
import { scholarshipPlugin } from './scholarship-plugin.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const CHILD = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';
const INSTITUTION = '00000000-0000-4000-8000-0000000000d1';

describe('parent scholarship routes', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('lets a parent draft only a linked child and hides the other child', async () => {
    const staff = Fastify({ logger: false });
    staff.decorateRequest('tenantId', '');
    staff.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = TENANT;
      (request as { user?: { sub: string; roles: unknown } }).user = {
        sub: 'officer',
        roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN' }],
      };
    });
    const repository = new InMemoryScholarshipRepository();
    const documents = new InMemoryScholarshipDocumentStore();
    const blobs = new InMemoryScholarshipDocumentBlobStore();
    await staff.register(scholarshipPlugin, {
      repository,
      prefix: '/scholarships',
      documentStore: documents,
      documentBlobs: blobs,
    });
    await staff.ready();
    const created = await staff.inject({
      method: 'POST',
      url: '/scholarships/programs',
      payload: {
        name: 'Family grant',
        applicationStartDate: '2020-01-01',
        applicationEndDate: '2099-12-31',
        totalSlots: 5,
        amountPerRecipient: 1000,
        eligibility: { requiredDocuments: ['income_certificate'] },
      },
    });
    expect(created.statusCode).toBe(201);
    const programId = created.json().id as string;
    expect(
      (
        await staff.inject({
          method: 'PUT',
          url: `/scholarships/programs/${programId}`,
          payload: { status: 'open' },
        })
      ).statusCode,
    ).toBe(200);
    await staff.close();

    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = TENANT;
      (request as { user?: { sub: string; roles: unknown; linkedStudentIds: string[] } }).user = {
        sub: 'parent-1',
        roles: [{ roleId: 'parent', roleName: 'Parent' }],
        linkedStudentIds: [CHILD],
      };
    });
    await app.register(parentScholarshipPlugin, {
      repository,
      prefix: '/parent-portal/scholarships',
      documentStore: documents,
      documentBlobs: blobs,
      resolveLinkedStudentIds: async () => [CHILD],
      resolveStudentInstitutionId: async () => INSTITUTION,
    });
    await app.ready();

    const body = {
      programId,
      institutionId: INSTITUTION,
      academicRecords: [{ institutionName: 'School', educationLevel: 'secondary' }],
      financialInfo: {},
      documents: [],
    };
    const own = await app.inject({
      method: 'POST',
      url: '/parent-portal/scholarships/applications',
      payload: { ...body, applicantId: CHILD },
    });
    expect(own.statusCode).toBe(201);
    // PRC-L345: a client-chosen institution that differs from the enrolment is refused.
    const wrongInstitution = await app.inject({
      method: 'POST',
      url: '/parent-portal/scholarships/applications',
      payload: { ...body, applicantId: CHILD, institutionId: OTHER },
    });
    expect(wrongInstitution.statusCode).toBe(422);

    const other = await app.inject({
      method: 'POST',
      url: '/parent-portal/scholarships/applications',
      payload: { ...body, applicantId: OTHER },
    });
    expect(other.statusCode).toBe(403);

    const list = await app.inject({
      method: 'GET',
      url: '/parent-portal/scholarships/applications',
    });
    expect(list.statusCode).toBe(200);
    const ids = (list.json().data as Array<{ applicantId: string }>).map((row) => row.applicantId);
    expect(ids).toContain(CHILD);
    expect(ids).not.toContain(OTHER);
  });

  it('PRC-L346: link lookup failure returns 503 and v7 UUID child sees own applications', async () => {
    const repository = new InMemoryScholarshipRepository();
    const V7_CHILD = '01890a5d-ac96-774b-bcce-b302099a8057';
    const program = await repository.createProgram({
      id: '00000000-0000-4000-8000-0000000000e1',
      tenantId: TENANT,
      name: 'Grant',
      status: 'open',
    } as never);
    await repository.createApplication({
      id: '00000000-0000-4000-8000-0000000000e2',
      submittedAt: new Date(),
      tenantId: TENANT,
      programId: (program as { id: string }).id,
      applicantId: V7_CHILD,
      institutionId: INSTITUTION,
      status: 'draft',
    } as never);
    const build = async (resolve: () => Promise<string[]>) => {
      const instance = Fastify({ logger: false });
      instance.decorateRequest('tenantId', '');
      instance.addHook('onRequest', async (request) => {
        (request as { tenantId?: string }).tenantId = TENANT;
        (request as { user?: unknown }).user = {
          sub: 'parent-1',
          roles: [{ roleId: 'parent', roleName: 'Parent' }],
          linkedStudentIds: [],
        };
      });
      await instance.register(parentScholarshipPlugin, {
        repository,
        prefix: '/p',
        documentStore: new InMemoryScholarshipDocumentStore(),
        documentBlobs: new InMemoryScholarshipDocumentBlobStore(),
        resolveLinkedStudentIds: resolve,
        resolveStudentInstitutionId: async () => INSTITUTION,
      });
      await instance.ready();
      return instance;
    };
    app = await build(async () => {
      throw new Error('connection refused');
    });
    const down = await app.inject({ method: 'GET', url: '/p/applications' });
    expect(down.statusCode).toBe(503);
    const downCreate = await app.inject({
      method: 'POST',
      url: '/p/applications',
      payload: {
        applicantId: V7_CHILD,
        programId: '00000000-0000-4000-8000-0000000000e1',
        institutionId: INSTITUTION,
        academicRecords: [{ institutionName: 'School', educationLevel: 'secondary' }],
        financialInfo: {},
        documents: [],
      },
    });
    expect(downCreate.statusCode).toBe(503);
    await app.close();
    app = await build(async () => [V7_CHILD]);
    const ok = await app.inject({ method: 'GET', url: '/p/applications?pageSize=10' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json().data as Array<{ applicantId: string }>).map((r) => r.applicantId)).toEqual([
      V7_CHILD,
    ]);
    expect(ok.json().meta.pageSize).toBe(10);
  });
});
