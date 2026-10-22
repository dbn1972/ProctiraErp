/**
 * PRC-M319 — staff provisioning routes (household / member / custody / restriction) and the
 * staff thread-list / staff-authored-thread routes, both wired to EXISTING ParentPortalService
 * methods. Staff-role bar reuses isConsentStaff || isFeesStaff (an explicit assumption flagged
 * in this task's findings for the PR body).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';
const PARENT_USER = '00000000-0000-4000-8000-000000000021';
const UNLINKED_PARENT = '00000000-0000-4000-8000-0000000000ff';

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

const registrar: Principal = {
  sub: '00000000-0000-4000-8000-0000000000d1',
  roles: [{ roleId: 'registrar', roleName: 'Registrar', areaId: null }],
};

describe('PRC-M319 staff provisioning + staff thread routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryParentPortalRepository;
  let householdId: string;

  beforeEach(async () => {
    repository = new InMemoryParentPortalRepository();
    app = createApp(repository);
    await app.register(parentPortalPlugin, { repository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('staff can create a household (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/parent-portal/households',
      headers: as(registrar),
      payload: { label: 'Household A' },
    });
    expect(res.statusCode).toBe(201);
    householdId = (res.json() as { id: string }).id;
    expect(householdId).toBeTruthy();
  });

  it('a non-staff caller gets 403 on all four provisioning routes', async () => {
    const household = await repository.createHousehold({
      id: '00000000-0000-4000-8000-000000000201',
      tenantId: TENANT_A,
      label: 'Household B',
      status: 'active',
    });

    const householdRes = await app.inject({
      method: 'POST',
      url: '/parent-portal/households',
      headers: as(parent),
      payload: { label: 'Nope' },
    });
    expect(householdRes.statusCode).toBe(403);

    const memberRes = await app.inject({
      method: 'POST',
      url: '/parent-portal/households/members',
      headers: as(parent),
      payload: { householdId: household.id, parentUserId: PARENT_USER },
    });
    expect(memberRes.statusCode).toBe(403);

    const custodyRes = await app.inject({
      method: 'POST',
      url: '/parent-portal/custody',
      headers: as(parent),
      payload: { studentId: STUDENT_ID, householdId: household.id },
    });
    expect(custodyRes.statusCode).toBe(403);

    const restrictionRes = await app.inject({
      method: 'POST',
      url: '/parent-portal/custody/restrictions',
      headers: as(parent),
      payload: { studentId: STUDENT_ID, parentUserId: PARENT_USER },
    });
    expect(restrictionRes.statusCode).toBe(403);
  });

  it('staff can provision a household, member, custody row, and restriction (2xx each)', async () => {
    const householdRes = await app.inject({
      method: 'POST',
      url: '/parent-portal/households',
      headers: as(registrar),
      payload: { label: 'Household C' },
    });
    expect(householdRes.statusCode).toBe(201);
    const household = householdRes.json() as { id: string };

    const memberRes = await app.inject({
      method: 'POST',
      url: '/parent-portal/households/members',
      headers: as(registrar),
      payload: { householdId: household.id, parentUserId: PARENT_USER, role: 'primary' },
    });
    expect(memberRes.statusCode).toBe(201);

    const custodyRes = await app.inject({
      method: 'POST',
      url: '/parent-portal/custody',
      headers: as(registrar),
      payload: { studentId: STUDENT_ID, householdId: household.id, custodyType: 'sole' },
    });
    expect(custodyRes.statusCode).toBe(201);

    const restrictionRes = await app.inject({
      method: 'POST',
      url: '/parent-portal/custody/restrictions',
      headers: as(registrar),
      payload: {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        courtOrderRef: 'COURT-001',
      },
    });
    expect(restrictionRes.statusCode).toBe(201);
  });

  async function provisionLinkedParent(): Promise<void> {
    const household = await repository.createHousehold({
      id: '00000000-0000-4000-8000-000000000301',
      tenantId: TENANT_A,
      label: 'Linked household',
      status: 'active',
    });
    await repository.addHouseholdMember({
      id: '00000000-0000-4000-8000-000000000302',
      tenantId: TENANT_A,
      householdId: household.id,
      parentUserId: PARENT_USER,
      role: 'primary',
      status: 'active',
    });
    await repository.assignStudentCustody({
      id: '00000000-0000-4000-8000-000000000303',
      tenantId: TENANT_A,
      studentId: STUDENT_ID,
      householdId: household.id,
      custodyType: 'sole',
      status: 'active',
      effectiveFrom: new Date(),
    });
    await repository.createChildLink({
      id: '00000000-0000-4000-8000-000000000304',
      tenantId: TENANT_A,
      parentUserId: PARENT_USER,
      studentId: STUDENT_ID,
      relationship: 'guardian',
      status: 'active',
      isPrimary: true,
      canConsentMedical: true,
      canViewFees: true,
      householdId: household.id,
    });
  }

  it("staff thread-list returns all of a student's threads across parents", async () => {
    await provisionLinkedParent();
    await repository.createThread({
      id: '00000000-0000-4000-8000-000000000401',
      tenantId: TENANT_A,
      studentId: STUDENT_ID,
      subject: 'Thread from parent',
      createdBy: PARENT_USER,
      status: 'open',
    });
    await repository.createThread({
      id: '00000000-0000-4000-8000-000000000402',
      tenantId: TENANT_A,
      studentId: STUDENT_ID,
      subject: 'Thread from another guardian',
      createdBy: 'other-guardian',
      status: 'open',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/parent-portal/messages/threads/staff?studentId=${STUDENT_ID}`,
      headers: as(registrar),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }>; meta: Record<string, number> };
    expect(body.data.map((t) => t.id).sort()).toEqual(
      ['00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402'].sort(),
    );
    expect(body.meta.totalItems).toBe(2);
  });

  it('non-staff caller is rejected 403 on staff thread-list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/parent-portal/messages/threads/staff?studentId=${STUDENT_ID}`,
      headers: as(parent),
    });
    expect(res.statusCode).toBe(403);
  });

  it('staff-authored-thread sets senderRole=staff', async () => {
    await provisionLinkedParent();

    const res = await app.inject({
      method: 'POST',
      url: '/parent-portal/messages/threads/staff',
      headers: as(registrar),
      payload: {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        subject: 'School notice',
        body: 'Please review the attached form.',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { message: { senderRole: string } };
    expect(body.message.senderRole).toBe('staff');
  });

  it('staff-authored-thread 422s for a parentUserId not actively linked to studentId', async () => {
    await provisionLinkedParent();

    const res = await app.inject({
      method: 'POST',
      url: '/parent-portal/messages/threads/staff',
      headers: as(registrar),
      payload: {
        studentId: STUDENT_ID,
        parentUserId: UNLINKED_PARENT,
        subject: 'School notice',
        body: 'Please review the attached form.',
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('non-staff caller is rejected 403 on staff-authored-thread', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/parent-portal/messages/threads/staff',
      headers: as(parent),
      payload: {
        studentId: STUDENT_ID,
        parentUserId: PARENT_USER,
        subject: 'School notice',
        body: 'Hello',
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
