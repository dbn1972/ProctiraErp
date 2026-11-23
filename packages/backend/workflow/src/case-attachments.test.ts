/**
 * PRC-M459 / topic 18: case attachment storage paths and uploader come from
 * the server. A client-supplied `storagePath` or `uploadedBy` is rejected
 * with 400; the stored record carries a tenant/case-scoped key and the
 * verified caller as uploader.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerCaseRoutes } from './case-routes.js';
import { CaseService } from './case-service.js';
import { InMemoryCaseRepository } from './in-memory-case-repository.js';
const TENANT_ID = 'tenant-m459';
const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const headers = { 'x-test-user': 'counsellor-7' };
let app: FastifyInstance;
beforeEach(async () => {
  app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
    const sub = request.headers['x-test-user'];
    if (typeof sub === 'string') {
      (request as typeof request & { user: unknown }).user = {
        sub,
        roles: [{ roleId: 'admin', roleName: 'ADMIN' }],
      };
    }
  });
  await registerCaseRoutes(app, { caseService: new CaseService(new InMemoryCaseRepository()) });
  await app.ready();
});
const baseCase = {
  type: 'counselling',
  title: 'Check-in',
  description: 'Weekly check-in',
  entityType: 'student',
  entityId: ENTITY_ID,
};
async function createCase(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/workflows/cases',
    headers,
    payload: baseCase,
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}
const file = { fileName: 'note.pdf', fileType: 'application/pdf', fileSize: 1024 };
describe('case attachments take storagePath and uploadedBy from the server (PRC-M459)', () => {
  it('rejects a client-supplied storagePath with 400', async () => {
    const caseId = await createCase();
    const res = await app.inject({
      method: 'POST',
      url: `/workflows/cases/${caseId}/attachments`,
      headers,
      payload: {
        ...file,
        storagePath: 'tenants/other-tenant/secret.pdf',
        uploadedBy: 'counsellor-7',
      },
    });
    expect(res.statusCode).toBe(400);
  });
  it('rejects a client-supplied uploadedBy with 400', async () => {
    const caseId = await createCase();
    const res = await app.inject({
      method: 'POST',
      url: `/workflows/cases/${caseId}/attachments`,
      headers,
      payload: {
        ...file,
        storagePath: `tenants/${TENANT_ID}/note.pdf`,
        uploadedBy: 'someone-else',
      },
    });
    expect(res.statusCode).toBe(400);
  });
  it('records a tenant/case-scoped storage key and the verified uploader', async () => {
    const caseId = await createCase();
    const res = await app.inject({
      method: 'POST',
      url: `/workflows/cases/${caseId}/attachments`,
      headers,
      payload: file,
    });
    expect(res.statusCode).toBe(200);
    const [attachment] = (
      res.json() as { attachments: { id: string; storagePath: string; uploadedBy: string }[] }
    ).attachments;
    expect(attachment!.uploadedBy).toBe('counsellor-7');
    expect(attachment!.storagePath).toBe(
      `tenants/${TENANT_ID}/cases/${caseId}/attachments/${attachment!.id}`,
    );
  });
  it('rejects client storage fields on initial attachments at case creation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workflows/cases',
      headers,
      payload: {
        ...baseCase,
        attachments: [
          { ...file, id: 'a1', storagePath: '/uploads/x.pdf', uploadedBy: 'someone-else' },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });
  it('builds initial attachments server-side at case creation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workflows/cases',
      headers,
      payload: { ...baseCase, attachments: [file] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      id: string;
      attachments: { id: string; storagePath: string; uploadedBy: string }[];
    };
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]!.uploadedBy).toBe('counsellor-7');
    expect(body.attachments[0]!.storagePath).toBe(
      `tenants/${TENANT_ID}/cases/${body.id}/attachments/${body.attachments[0]!.id}`,
    );
  });
});
