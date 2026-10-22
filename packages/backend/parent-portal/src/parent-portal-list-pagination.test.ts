/**
 * PRC-M536 — page/pageSize pagination for the previously-unbounded consent and
 * message-thread list routes. The fee-route pagination tests live alongside the
 * existing PRC-C008 suite in parent-portal-fees-authz.test.ts; this file covers the
 * consents and threads routes named explicitly in FEAT-003.json's acceptance criteria.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const PARENT_USER = '00000000-0000-4000-8000-000000000021';
const HOUSEHOLD_H1 = '00000000-0000-4000-8000-000000000101';

interface Principal {
  sub: string;
  email?: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }>;
}

function createApp(repository: InMemoryParentPortalRepository): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null as unknown as Principal);
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT_A;
    const principal = request.headers['x-test-principal'];
    (request as unknown as { user: Principal | null }).user =
      typeof principal === 'string' ? (JSON.parse(principal) as Principal) : null;
  });
  return app;
}

function as(principal: Principal) {
  return { 'x-test-principal': JSON.stringify(principal) };
}

const parent: Principal = {
  sub: PARENT_USER,
  email: 'parent@tenant.test',
  roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
};

async function provisionLinkedParent(
  repository: InMemoryParentPortalRepository,
  studentId: string,
): Promise<void> {
  const now = new Date();
  const existing = await repository.listActiveHouseholdIdsForParent(TENANT_A, PARENT_USER);
  if (!existing.includes(HOUSEHOLD_H1)) {
    await repository.createHousehold({
      id: HOUSEHOLD_H1,
      tenantId: TENANT_A,
      label: 'Demo household',
      status: 'active',
    });
    await repository.addHouseholdMember({
      id: `member-${studentId}`,
      tenantId: TENANT_A,
      householdId: HOUSEHOLD_H1,
      parentUserId: PARENT_USER,
      role: 'primary',
      status: 'active',
    });
  }
  await repository.assignStudentCustody({
    id: `custody-${studentId}`,
    tenantId: TENANT_A,
    studentId,
    householdId: HOUSEHOLD_H1,
    custodyType: 'sole',
    status: 'active',
    effectiveFrom: now,
  });
  await repository.createChildLink({
    id: `link-${studentId}`,
    tenantId: TENANT_A,
    parentUserId: PARENT_USER,
    studentId,
    relationship: 'guardian',
    status: 'active',
    isPrimary: true,
    canConsentMedical: true,
    canViewFees: true,
    householdId: HOUSEHOLD_H1,
  });
}

describe('PRC-M536 consent/thread list pagination', () => {
  let app: FastifyInstance;
  let repository: InMemoryParentPortalRepository;

  beforeEach(async () => {
    repository = new InMemoryParentPortalRepository();
    app = createApp(repository);
    await app.register(parentPortalPlugin, { repository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('consents: pageSize=10 returns exactly 10 rows with correct meta for 25 seeded rows', async () => {
    const studentId = '00000000-0000-4000-8000-000000009001';
    await provisionLinkedParent(repository, studentId);
    for (let i = 0; i < 25; i++) {
      const id = `00000000-0000-4000-8000-0000010${String(i).padStart(3, '0')}`;
      await repository.createConsent({
        id,
        tenantId: TENANT_A,
        studentId,
        parentUserId: PARENT_USER,
        consentType: 'photo_media',
        title: `Consent ${i}`,
        description: '',
        status: 'pending',
        consentVersion: `v${i}`,
        consentChainId: id,
        version: 1,
        supersedesId: null,
        validFrom: new Date(),
        createdBy: 'staff',
        withdrawalReason: null,
        decidedVia: null,
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/parent-portal/consents?pageSize=10',
      headers: as(parent),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: Record<string, number> };
    expect(body.data).toHaveLength(10);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 10, totalItems: 25, totalPages: 3 });
  });

  it('threads: pageSize=10 returns exactly 10 rows with correct meta for 25 seeded rows', async () => {
    const studentId = '00000000-0000-4000-8000-000000009002';
    await provisionLinkedParent(repository, studentId);
    for (let i = 0; i < 25; i++) {
      const thread = await repository.createThread({
        id: `00000000-0000-4000-8000-0000011${String(i).padStart(3, '0')}`,
        tenantId: TENANT_A,
        studentId,
        subject: `Thread ${i}`,
        createdBy: PARENT_USER,
        status: 'open',
      });
      await repository.createMessage({
        id: `00000000-0000-4000-8000-0000012${String(i).padStart(3, '0')}`,
        threadId: thread.id,
        tenantId: TENANT_A,
        senderUserId: PARENT_USER,
        senderRole: 'parent',
        body: `Hello ${i}`,
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/parent-portal/messages/threads?pageSize=10',
      headers: as(parent),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: Record<string, number> };
    expect(body.data).toHaveLength(10);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 10, totalItems: 25, totalPages: 3 });
  });

  it('messages-in-thread: pageSize=10 returns exactly 10 rows with correct meta for 25 seeded messages', async () => {
    const studentId = '00000000-0000-4000-8000-000000009003';
    await provisionLinkedParent(repository, studentId);
    const thread = await repository.createThread({
      id: '00000000-0000-4000-8000-000000013001',
      tenantId: TENANT_A,
      studentId,
      subject: 'Long thread',
      createdBy: PARENT_USER,
      status: 'open',
    });
    for (let i = 0; i < 25; i++) {
      await repository.createMessage({
        id: `00000000-0000-4000-8000-0000014${String(i).padStart(3, '0')}`,
        threadId: thread.id,
        tenantId: TENANT_A,
        senderUserId: PARENT_USER,
        senderRole: 'parent',
        body: `Message ${i}`,
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/parent-portal/messages/threads/${thread.id}/messages?pageSize=10`,
      headers: as(parent),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: Record<string, number> };
    expect(body.data).toHaveLength(10);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 10, totalItems: 25, totalPages: 3 });
  });
});
