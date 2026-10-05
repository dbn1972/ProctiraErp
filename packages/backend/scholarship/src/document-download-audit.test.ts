/**
 * PRC-L344: every served scholarship document download writes exactly one durable access record
 * (the PRC-M353 hash-chained access log, via the document store) before bytes are sent, and the
 * single-use jti guard is shared across gateway replicas (Redis SET NX EX).
 */
import { Buffer } from 'node:buffer';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDownloadTokenReplayGuard,
  DownloadTokenReplayGuard,
  PLACEHOLDER_PDF,
  RedisDownloadTokenReplayGuard,
  type DownloadTokenReplayStore,
  type RedisLikeForDownloadReplay,
  signDocumentDownloadToken,
} from './document-bytes.js';
import { InMemoryScholarshipDocumentBlobStore } from './document-blob-store.js';
import {
  InMemoryScholarshipDocumentStore,
  SCHOLARSHIP_DOCUMENT_ACCESS_ENTITY,
  type ScholarshipDocumentStore,
} from './document-store.js';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { scholarshipPlugin } from './scholarship-plugin.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';
const STUDENT = '00000000-0000-4000-8000-0000000000c1';
const INSTITUTION = '00000000-0000-4000-8000-0000000000d1';

/** Shared fake Redis: one key space seen by every "replica". */
class FakeRedis implements RedisLikeForDownloadReplay {
  readonly keys = new Map<string, { value: string; ttl: number }>();
  async set(key: string, value: string, _mode: 'EX', ttl: number, _nx: 'NX') {
    if (this.keys.has(key)) return null;
    this.keys.set(key, { value, ttl });
    return 'OK';
  }
}

function multipart(data: Buffer) {
  const boundary = '----proctiraDoc';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\nincome_certificate\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="income.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  return {
    payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

const documents = new InMemoryScholarshipDocumentStore();
const blobs = new InMemoryScholarshipDocumentBlobStore();
const repository = new InMemoryScholarshipRepository();

async function buildReplica(options: {
  downloadReplayGuard?: DownloadTokenReplayStore;
  documentStore?: ScholarshipDocumentStore;
  sub?: string;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as { tenantId?: string }).tenantId = TENANT;
    (request as { user?: { sub: string; roles: string[] } }).user = {
      sub: options.sub ?? 'staff-1',
      roles: ['bursar'],
    };
  });
  await app.register(scholarshipPlugin, {
    repository,
    prefix: '/scholarships',
    documentStore: options.documentStore ?? documents,
    documentBlobs: blobs,
    downloadReplayGuard: options.downloadReplayGuard,
  });
  await app.ready();
  return app;
}

async function uploadDocument(app: FastifyInstance): Promise<string> {
  const program = await app.inject({
    method: 'POST',
    url: '/scholarships/programs',
    payload: {
      name: 'Need grant',
      applicationStartDate: '2020-01-01',
      applicationEndDate: '2099-12-31',
      totalSlots: 5,
      amountPerRecipient: 1000,
      eligibility: { requiredDocuments: [] },
    },
  });
  const programId = program.json().id as string;
  await app.inject({
    method: 'PUT',
    url: `/scholarships/programs/${programId}`,
    payload: { status: 'open' },
  });
  const draft = await app.inject({
    method: 'POST',
    url: '/scholarships/applications',
    payload: {
      programId,
      applicantId: STUDENT,
      institutionId: INSTITUTION,
      academicRecords: [{ institutionName: 'Sunrise', educationLevel: 'secondary' }],
      financialInfo: {},
      documents: [],
      asDraft: true,
    },
  });
  const file = multipart(PLACEHOLDER_PDF);
  const uploaded = await app.inject({
    method: 'POST',
    url: `/scholarships/applications/${draft.json().id as string}/documents`,
    payload: file.payload,
    headers: { 'content-type': file.contentType },
  });
  expect(uploaded.statusCode).toBe(201);
  return uploaded.json().id as string;
}

function download(app: FastifyInstance, token: string) {
  return app.inject({
    method: 'GET',
    url: `/scholarships/document-downloads?token=${encodeURIComponent(token)}`,
    headers: { 'user-agent': 'vitest' },
  });
}

describe('scholarship document download audit + shared replay guard (PRC-L344)', () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('records exactly one durable access row for every served download', async () => {
    const store = new InMemoryScholarshipDocumentStore();
    const app = await buildReplica({ documentStore: store });
    apps.push(app);
    const documentId = await uploadDocument(app);
    const downloadRows = () =>
      store.audits.filter(
        (entry) =>
          entry.entityType === SCHOLARSHIP_DOCUMENT_ACCESS_ENTITY &&
          entry.metadata['action'] === 'token_download',
      );
    const { token } = signDocumentDownloadToken({ tenantId: TENANT, documentId, sub: 'staff-1' });
    const res = await download(app, token);
    expect(res.statusCode).toBe(200);
    // One access, one row: no second audit sink writes a duplicate for the same download.
    expect(downloadRows()).toHaveLength(1);
    expect(
      store.audits.filter((entry) => entry.entityType === SCHOLARSHIP_DOCUMENT_ACCESS_ENTITY),
    ).toHaveLength(1);
    expect(downloadRows()[0]).toMatchObject({
      tenantId: TENANT,
      entityId: documentId,
      userId: 'staff-1',
      metadata: {
        event: 'scholarship.document.downloaded',
        documentId,
        linkUserId: 'staff-1',
        sessionUserId: 'staff-1',
        userAgent: 'vitest',
      },
    });
    expect(downloadRows()[0]!.metadata['jti']).toMatch(/.+/);
    expect(downloadRows()[0]!.metadata['requestId']).toMatch(/.+/);
    // A replayed link is refused and produces no further download record.
    expect((await download(app, token)).statusCode).toBe(401);
    expect(downloadRows()).toHaveLength(1);
  });

  it('refuses to serve the document (503) when the access row cannot be written', async () => {
    const store = new InMemoryScholarshipDocumentStore();
    store.recordAccess = async () => {
      throw new Error('audit store down');
    };
    const app = await buildReplica({ documentStore: store });
    apps.push(app);
    const documentId = await uploadDocument(app);
    const { token } = signDocumentDownloadToken({ tenantId: TENANT, documentId, sub: 'staff-1' });
    const res = await download(app, token);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('AUDIT_UNAVAILABLE');
    expect(res.body.startsWith('%PDF')).toBe(false);
  });

  it('holds single-use across two replicas sharing the Redis guard', async () => {
    const redis = new FakeRedis();
    const replicaA = await buildReplica({
      downloadReplayGuard: new RedisDownloadTokenReplayGuard(redis),
    });
    const replicaB = await buildReplica({
      downloadReplayGuard: new RedisDownloadTokenReplayGuard(redis),
    });
    apps.push(replicaA, replicaB);
    const documentId = await uploadDocument(replicaA);
    const { token } = signDocumentDownloadToken({ tenantId: TENANT, documentId, sub: 'staff-1' });
    expect((await download(replicaA, token)).statusCode).toBe(200);
    const replay = await download(replicaB, token);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().message).toMatch(/already been used/);
    const [key, entry] = [...redis.keys.entries()][0]!;
    expect(key.startsWith('scholarship:doc-jti:')).toBe(true);
    expect(entry.ttl).toBeGreaterThan(0);
  });

  it('fails closed when the shared replay store errors', async () => {
    const app = await buildReplica({
      downloadReplayGuard: new RedisDownloadTokenReplayGuard({
        set: async () => {
          throw new Error('redis down');
        },
      }),
    });
    apps.push(app);
    const documentId = await uploadDocument(app);
    const { token } = signDocumentDownloadToken({ tenantId: TENANT, documentId, sub: 'staff-1' });
    const res = await download(app, token);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.body.startsWith('%PDF')).toBe(false);
  });

  it('chooses Redis when injected and refuses a process-local guard in production', () => {
    expect(createDownloadTokenReplayGuard({ redis: new FakeRedis() })).toBeInstanceOf(
      RedisDownloadTokenReplayGuard,
    );
    expect(createDownloadTokenReplayGuard({ NODE_ENV: 'test' })).toBeInstanceOf(
      DownloadTokenReplayGuard,
    );
    expect(() => createDownloadTokenReplayGuard({ NODE_ENV: 'production' })).toThrow(/REDIS_URL/);
  });
});
