/**
 * PRC-M314 / NEW-g4_apps_auth-003: senderRole must be derived from verified JWT roles,
 * never from the request body. These Fastify route-level tests prove that a parent
 * cannot inject a 'staff'/'system' message and that staff posts are labelled 'staff'.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EmptyAcademicVisibilityStore } from './academic-visibility.js';
import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';
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
    const tenant = request.headers['x-tenant-id'];
    (request as unknown as { tenantId: string }).tenantId =
      typeof tenant === 'string' ? tenant : TENANT_A;
    const principal = request.headers['x-test-principal'];
    (request as unknown as { user: Principal | null }).user =
      typeof principal === 'string' ? (JSON.parse(principal) as Principal) : null;
  });
  return app;
}

function as(principal: Principal, tenantId = TENANT_A) {
  return {
    'x-tenant-id': tenantId,
    'x-test-principal': JSON.stringify(principal),
  };
}

const parent: Principal = {
  sub: PARENT_USER,
  email: 'parent@tenant.test',
  roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
};

const teacher: Principal = {
  sub: '00000000-0000-4000-8000-0000000000e1',
  email: 'teacher@tenant.test',
  roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: null }],
};

async function provisionLinkedParent(repository: InMemoryParentPortalRepository): Promise<void> {
  const now = new Date();
  await repository.createHousehold({
    id: HOUSEHOLD_H1,
    tenantId: TENANT_A,
    label: 'Demo household',
    status: 'active',
  });
  await repository.addHouseholdMember({
    id: '00000000-0000-4000-8000-000000000111',
    tenantId: TENANT_A,
    householdId: HOUSEHOLD_H1,
    parentUserId: PARENT_USER,
    role: 'primary',
    status: 'active',
  });
  await repository.assignStudentCustody({
    id: '00000000-0000-4000-8000-000000000121',
    tenantId: TENANT_A,
    studentId: STUDENT_ID,
    householdId: HOUSEHOLD_H1,
    custodyType: 'sole',
    status: 'active',
    effectiveFrom: now,
  });
  await repository.createChildLink({
    id: '00000000-0000-4000-8000-000000000131',
    tenantId: TENANT_A,
    parentUserId: PARENT_USER,
    studentId: STUDENT_ID,
    relationship: 'guardian',
    status: 'active',
    isPrimary: true,
    canConsentMedical: true,
    canViewFees: true,
    householdId: HOUSEHOLD_H1,
  });
}

describe('parent-portal message senderRole derivation (PRC-M314 / NEW-g4_apps_auth-003)', () => {
  let app: FastifyInstance;
  let repository: InMemoryParentPortalRepository;

  beforeEach(async () => {
    repository = new InMemoryParentPortalRepository();
    app = createApp(repository);
    await app.register(parentPortalPlugin, {
      repository,
      academicStore: new EmptyAcademicVisibilityStore(),
    });
    await app.ready();
    await provisionLinkedParent(repository);
  });

  afterEach(async () => {
    await app.close();
  });

  async function createThread(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/parent-portal/messages/threads',
      headers: as(parent),
      payload: { studentId: STUDENT_ID, subject: 'Fees', body: 'Hello' },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { thread: { id: string } }).thread.id;
  }

  it('ignores a client-supplied senderRole and stores the message as parent', async () => {
    const threadId = await createThread();
    const res = await app.inject({
      method: 'POST',
      url: `/parent-portal/messages/threads/${threadId}/messages`,
      headers: as(parent),
      // Attempt to impersonate the school.
      payload: { body: 'Pay to this account now', senderRole: 'staff' },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json() as { senderRole: string };
    expect(msg.senderRole).toBe('parent');
  });

  it('derives senderRole=staff from a teacher JWT', async () => {
    const threadId = await createThread();
    const res = await app.inject({
      method: 'POST',
      url: `/parent-portal/messages/threads/${threadId}/messages`,
      headers: as(teacher),
      payload: { body: 'Reminder from the school' },
    });
    expect(res.statusCode).toBe(201);
    const msg = res.json() as { senderRole: string };
    expect(msg.senderRole).toBe('staff');
  });

  it('never lets an unlinked parent post as parent (link check still enforced)', async () => {
    const threadId = await createThread();
    const stranger: Principal = {
      sub: '00000000-0000-4000-8000-0000000000ff',
      roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
    };
    const res = await app.inject({
      method: 'POST',
      url: `/parent-portal/messages/threads/${threadId}/messages`,
      headers: as(stranger),
      payload: { body: 'I am not linked', senderRole: 'staff' },
    });
    // Derived role is 'parent' (not staff), so the guardian-link check runs and fails.
    expect([403, 404]).toContain(res.statusCode);
  });
});
