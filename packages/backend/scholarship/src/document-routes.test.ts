/**
 * Scholarship document upload: mime/size, tenancy, and signed URL expiry.
 */
import { Buffer } from 'node:buffer';

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { signDocumentDownloadToken, PLACEHOLDER_PDF } from './document-bytes.js';
import { InMemoryScholarshipDocumentBlobStore } from './document-blob-store.js';
import { InMemoryScholarshipDocumentStore } from './document-store.js';
import { scholarshipPlugin } from './scholarship-plugin.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';

const TENANT_A = '00000000-0000-4000-8000-0000000000a1';
const TENANT_B = '00000000-0000-4000-8000-0000000000b2';
const STUDENT_A = '00000000-0000-4000-8000-0000000000c1';
const STUDENT_B = '00000000-0000-4000-8000-0000000000c2';
const INSTITUTION = '00000000-0000-4000-8000-0000000000d1';

function multipart(documentType: string, filename: string, mime: string, data: Buffer) {
  const boundary = '----proctiraDoc';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\n${documentType}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function buildApp(input: {
  tenantId: string;
  roles: unknown;
  sub?: string;
  linkedStudentIds?: string[];
  documents: InMemoryScholarshipDocumentStore;
  blobs: InMemoryScholarshipDocumentBlobStore;
  repository: InMemoryScholarshipRepository;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as { tenantId?: string }).tenantId = input.tenantId;
    (
      request as {
        user?: { sub?: string; roles?: unknown; linkedStudentIds?: string[] };
      }
    ).user = {
      sub: input.sub ?? 'staff-1',
      roles: input.roles,
      linkedStudentIds: input.linkedStudentIds,
    };
  });
  await app.register(scholarshipPlugin, {
    repository: input.repository,
    prefix: '/scholarships',
    documentStore: input.documents,
    documentBlobs: input.blobs,
  });
  await app.ready();
  return app;
}

async function openProgram(app: FastifyInstance, requiredDocuments: string[] = []) {
  const created = await app.inject({
    method: 'POST',
    url: '/scholarships/programs',
    payload: {
      name: 'Need grant',
      applicationStartDate: '2020-01-01',
      applicationEndDate: '2099-12-31',
      totalSlots: 5,
      amountPerRecipient: 1000,
      eligibility: { requiredDocuments },
    },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().id as string;
  const opened = await app.inject({
    method: 'PUT',
    url: `/scholarships/programs/${id}`,
    payload: { status: 'open' },
  });
  expect(opened.statusCode).toBe(200);
  return id;
}

describe('scholarship document routes', () => {
  let app: FastifyInstance;
  const documents = new InMemoryScholarshipDocumentStore();
  const blobs = new InMemoryScholarshipDocumentBlobStore();
  const repository = new InMemoryScholarshipRepository();

  afterEach(async () => {
    if (app) await app.close();
    documents.rows.clear();
    documents.audits.length = 0;
  });

  it('rejects a non-pdf/jpeg/png payload and an oversized pdf', async () => {
    app = await buildApp({
      tenantId: TENANT_A,
      roles: ['bursar'],
      documents,
      blobs,
      repository,
    });
    const programId = await openProgram(app);
    const draft = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: {
        programId,
        applicantId: STUDENT_A,
        institutionId: INSTITUTION,
        academicRecords: [{ institutionName: 'Sunrise', educationLevel: 'secondary' }],
        financialInfo: {},
        documents: [],
        asDraft: true,
      },
    });
    expect(draft.statusCode).toBe(201);
    const applicationId = draft.json().id as string;

    const text = multipart('income_certificate', 'notes.txt', 'text/plain', Buffer.from('hello'));
    const badType = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${applicationId}/documents`,
      payload: text.payload,
      headers: { 'content-type': text.contentType },
    });
    expect(badType.statusCode).toBe(400);
    expect(badType.json().message).toMatch(/PDF, JPEG, or PNG/);

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    oversized.set(Buffer.from('%PDF'), 0);
    const big = multipart('income_certificate', 'big.pdf', 'application/pdf', oversized);
    const tooBig = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${applicationId}/documents`,
      payload: big.payload,
      headers: { 'content-type': big.contentType },
    });
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json().message).toMatch(/10 MB/);
  });

  it('stores a pdf, hides it from another tenant, and expires the signed URL', async () => {
    app = await buildApp({
      tenantId: TENANT_A,
      roles: ['bursar'],
      documents,
      blobs,
      repository,
    });
    const programId = await openProgram(app, ['income_certificate']);
    const draft = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: {
        programId,
        applicantId: STUDENT_A,
        institutionId: INSTITUTION,
        academicRecords: [{ institutionName: 'Sunrise', educationLevel: 'secondary' }],
        financialInfo: {},
        documents: [],
        asDraft: true,
      },
    });
    const applicationId = draft.json().id as string;
    const file = multipart(
      'income_certificate',
      '../../income certificate.pdf',
      'application/pdf',
      PLACEHOLDER_PDF,
    );
    const uploaded = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${applicationId}/documents`,
      payload: file.payload,
      headers: { 'content-type': file.contentType },
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().originalFilename).toBe('income certificate.pdf');
    expect(uploaded.json().verificationStatus).toBe('PENDING');
    expect(documents.audits.some((entry) => entry.operation === 'CREATE')).toBe(true);

    const blocked = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${applicationId}/submit`,
    });
    expect(blocked.statusCode).toBe(200);

    await app.close();
    app = await buildApp({
      tenantId: TENANT_B,
      roles: ['bursar'],
      documents,
      blobs,
      repository,
    });
    const cross = await app.inject({
      method: 'GET',
      url: `/scholarships/applications/${applicationId}/documents`,
    });
    expect(cross.statusCode).toBe(404);

    await app.close();
    app = await buildApp({
      tenantId: TENANT_A,
      roles: ['bursar'],
      documents,
      blobs,
      repository,
    });
    const download = await app.inject({
      method: 'GET',
      url: `/scholarships/applications/${applicationId}/documents/${uploaded.json().id}/download`,
    });
    expect(download.statusCode).toBe(200);
    const downloadUrl = new URL(String(download.json().url), 'http://localhost');
    const token = downloadUrl.searchParams.get('token')!;
    const ok = await app.inject({
      method: 'GET',
      url: `/scholarships/document-downloads?token=${encodeURIComponent(token)}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.startsWith('%PDF')).toBe(true);
    // PRC-M353: link minting and token redemption are access-logged with actor + document.
    const access = documents.audits.filter(
      (entry) => entry.entityType === 'scholarship_application_document_access',
    );
    const docId = uploaded.json().id as string;
    expect(access.map((entry) => entry.metadata.action)).toEqual(
      expect.arrayContaining(['download_link', 'token_download']),
    );
    expect(access.every((entry) => entry.userId === 'staff-1' && entry.tenantId === TENANT_A)).toBe(
      true,
    );
    expect(access.filter((entry) => entry.metadata.documentId === docId).length).toBe(2);
    // Fails closed: when the access log cannot be written no bytes are served.
    const original = documents.recordAccess.bind(documents);
    documents.recordAccess = async () => {
      throw new Error('audit down');
    };
    try {
      const listWhileDown = await app.inject({
        method: 'GET',
        url: `/scholarships/applications/${applicationId}/documents`,
      });
      expect(listWhileDown.statusCode).toBeGreaterThanOrEqual(500);
      const contentWhileDown = await app.inject({
        method: 'GET',
        url: `/scholarships/applications/${applicationId}/documents/${docId}/content`,
      });
      expect(contentWhileDown.statusCode).toBeGreaterThanOrEqual(500);
      expect(contentWhileDown.body.startsWith('%PDF')).toBe(false);
    } finally {
      documents.recordAccess = original;
    }
    // PRC-L344: links are single-use.
    const replay = await app.inject({
      method: 'GET',
      url: `/scholarships/document-downloads?token=${encodeURIComponent(token)}`,
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().message).toMatch(/already been used/);
    // PRC-L344: a link minted for user X is refused when presented by user Y.
    const forOther = signDocumentDownloadToken({
      tenantId: TENANT_A,
      documentId: uploaded.json().id as string,
      sub: 'someone-else',
    });
    const crossUser = await app.inject({
      method: 'GET',
      url: `/scholarships/document-downloads?token=${encodeURIComponent(forOther.token)}`,
    });
    expect(crossUser.statusCode).toBe(403);

    const expired = signDocumentDownloadToken({
      tenantId: TENANT_A,
      documentId: uploaded.json().id as string,
      exp: Math.floor(Date.now() / 1000) - 30,
    });
    const stale = await app.inject({
      method: 'GET',
      url: `/scholarships/document-downloads?token=${encodeURIComponent(expired.token)}`,
    });
    expect(stale.statusCode).toBe(401);
    expect(stale.json().message).toMatch(/expired/);
  });

  it('returns 403 when another parent uploads to a student they do not link', async () => {
    app = await buildApp({
      tenantId: TENANT_A,
      roles: ['bursar'],
      documents,
      blobs,
      repository,
    });
    const programId = await openProgram(app);
    const draft = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: {
        programId,
        applicantId: STUDENT_A,
        institutionId: INSTITUTION,
        academicRecords: [{ institutionName: 'Sunrise', educationLevel: 'secondary' }],
        financialInfo: {},
        documents: [],
        asDraft: true,
      },
    });
    const applicationId = draft.json().id as string;
    await app.close();

    app = await buildApp({
      tenantId: TENANT_A,
      roles: ['parent'],
      sub: 'parent-other',
      linkedStudentIds: [STUDENT_B],
      documents,
      blobs,
      repository,
    });
    const file = multipart('id_proof', 'id.pdf', 'application/pdf', PLACEHOLDER_PDF);
    const denied = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${applicationId}/documents`,
      payload: file.payload,
      headers: { 'content-type': file.contentType },
    });
    expect(denied.statusCode).toBe(403);

    await app.close();
    app = await buildApp({
      tenantId: TENANT_A,
      roles: ['parent'],
      sub: 'parent-mehta',
      linkedStudentIds: [STUDENT_A],
      documents,
      blobs,
      repository,
    });
    const allowed = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${applicationId}/documents`,
      payload: file.payload,
      headers: { 'content-type': file.contentType },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('blocks submit when a required document was rejected', async () => {
    app = await buildApp({
      tenantId: TENANT_A,
      roles: ['scholarship_officer'],
      sub: 'reviewer-1',
      documents,
      blobs,
      repository,
    });
    const programId = await openProgram(app, ['marksheet']);
    const draft = await app.inject({
      method: 'POST',
      url: '/scholarships/applications',
      payload: {
        programId,
        applicantId: STUDENT_A,
        institutionId: INSTITUTION,
        academicRecords: [{ institutionName: 'Sunrise', educationLevel: 'secondary' }],
        financialInfo: {},
        documents: [],
        asDraft: true,
      },
    });
    const applicationId = draft.json().id as string;
    const file = multipart('marksheet', 'marks.pdf', 'application/pdf', PLACEHOLDER_PDF);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${applicationId}/documents`,
      payload: file.payload,
      headers: { 'content-type': file.contentType },
    });
    const documentId = uploaded.json().id as string;
    const rejected = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${applicationId}/documents/${documentId}/reject`,
      payload: { reason: 'Unreadable scan' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().verificationStatus).toBe('REJECTED');
    const submit = await app.inject({
      method: 'POST',
      url: `/scholarships/applications/${applicationId}/submit`,
    });
    expect(submit.statusCode).toBe(400);
    expect(submit.json().message).toMatch(/marksheet/);
  });
});
