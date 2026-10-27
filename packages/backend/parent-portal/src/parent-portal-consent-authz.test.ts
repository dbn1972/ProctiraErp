/**
 * PRC-M601 — route-level role separation for the parent-portal consent routes (Fastify inject,
 * not the service directly):
 *  - guardians/students cannot create or supersede consent requests (PRC-H073 staff gate → 403);
 *  - a guardian cannot decide/withdraw/read history of a consent raised for another family's
 *    child (→ 404, no existence oracle);
 *  - a tenant-B principal cannot touch tenant-A consent ids, even as staff (→ 404).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';
import { ParentPortalService } from './parent-portal-service.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-000000000002';
const PARENT_USER = '00000000-0000-4000-8000-000000000021';
const OTHER_PARENT_USER = '00000000-0000-4000-8000-000000000022';
const CHILD = '00000000-0000-4000-8000-000000000031';
const OTHER_CHILD = '00000000-0000-4000-8000-000000000032';

interface Principal {
  sub: string;
  email?: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }>;
}

function createApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null as unknown as Principal);
  app.addHook('onRequest', async (request) => {
    const tenant = request.headers['x-test-tenant'];
    (request as unknown as { tenantId: string }).tenantId =
      typeof tenant === 'string' ? tenant : TENANT_A;
    const principal = request.headers['x-test-principal'];
    (request as unknown as { user: Principal | null }).user =
      typeof principal === 'string' ? (JSON.parse(principal) as Principal) : null;
  });
  return app;
}

function as(principal: Principal, tenantId: string = TENANT_A) {
  return { 'x-test-principal': JSON.stringify(principal), 'x-test-tenant': tenantId };
}

const parent: Principal = {
  sub: PARENT_USER,
  email: 'parent@tenant.test',
  roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
};

const otherParent: Principal = {
  sub: OTHER_PARENT_USER,
  email: 'other-parent@tenant.test',
  roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
};

const student: Principal = {
  sub: '00000000-0000-4000-8000-0000000000cc',
  roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
};

const registrar: Principal = {
  sub: '00000000-0000-4000-8000-0000000000dd',
  roles: [{ roleId: 'registrar', roleName: 'Registrar', areaId: null }],
};

const tenantBRegistrar: Principal = {
  sub: '00000000-0000-4000-8000-0000000000ee',
  roles: [{ roleId: 'registrar', roleName: 'Registrar', areaId: null }],
};

const tenantBParent: Principal = {
  // Same subject as the tenant-A guardian: tenant binding, not the sub, must deny.
  sub: PARENT_USER,
  roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
};

describe('PRC-M601 parent-portal consent route role separation', () => {
  let app: FastifyInstance;
  let repository: InMemoryParentPortalRepository;

  /** Household + custody + active link, as staff provisioning does (fail-closed custody). */
  async function link(tenantId: string, parentUserId: string, studentId: string): Promise<void> {
    const service = new ParentPortalService(repository);
    const householdId = crypto.randomUUID();
    await service.createHousehold(tenantId, { id: householdId, label: `H-${parentUserId}` });
    await service.addHouseholdMember(tenantId, { householdId, parentUserId, role: 'primary' });
    await service.assignStudentCustody(tenantId, { studentId, householdId, custodyType: 'sole' });
    await service.linkChild(
      tenantId,
      parentUserId,
      {
        studentId,
        householdId,
        relationship: 'guardian',
        isPrimary: true,
        canConsentMedical: true,
        canViewFees: true,
      },
      { isStaff: true },
    );
  }

  /** Staff raises a consent request for (parentUserId, studentId) in tenant A via the route. */
  async function raiseConsent(parentUserId: string, studentId: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/parent-portal/consents',
      headers: as(registrar),
      payload: {
        studentId,
        parentUserId,
        consentType: 'photo_media',
        title: 'Photo consent',
        consentVersion: 'photo-v1',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { id: string }).id;
  }

  beforeEach(async () => {
    repository = new InMemoryParentPortalRepository();
    app = createApp();
    await app.register(parentPortalPlugin, { repository });
    await app.ready();
    await link(TENANT_A, PARENT_USER, CHILD);
    await link(TENANT_A, OTHER_PARENT_USER, OTHER_CHILD);
  });

  afterEach(async () => {
    await app.close();
  });

  it('denies guardian and student on consent create (403) and lets staff create (201)', async () => {
    for (const principal of [parent, student]) {
      const res = await app.inject({
        method: 'POST',
        url: '/parent-portal/consents',
        headers: as(principal),
        payload: {
          studentId: CHILD,
          parentUserId: PARENT_USER,
          consentType: 'photo_media',
          title: 'Forged consent',
          consentVersion: 'photo-v1',
        },
      });
      expect(res.statusCode, `${principal.roles[0]!.roleId} create`).toBe(403);
    }
    await raiseConsent(PARENT_USER, CHILD);
  });

  it('denies guardian and student on consent supersede (403) and lets staff supersede (201)', async () => {
    const consentId = await raiseConsent(PARENT_USER, CHILD);
    for (const principal of [parent, student]) {
      const res = await app.inject({
        method: 'POST',
        url: `/parent-portal/consents/${consentId}/supersede`,
        headers: as(principal),
        payload: { consentVersion: 'photo-v2' },
      });
      expect(res.statusCode, `${principal.roles[0]!.roleId} supersede`).toBe(403);
    }
    const staffRes = await app.inject({
      method: 'POST',
      url: `/parent-portal/consents/${consentId}/supersede`,
      headers: as(registrar),
      payload: { consentVersion: 'photo-v2' },
    });
    expect(staffRes.statusCode, staffRes.body).toBe(201);
  });

  it("returns 404 when a guardian decides, withdraws or reads another family's consent", async () => {
    const otherConsentId = await raiseConsent(OTHER_PARENT_USER, OTHER_CHILD);

    const decide = await app.inject({
      method: 'POST',
      url: `/parent-portal/consents/${otherConsentId}/decide`,
      headers: as(parent),
      payload: { status: 'approved' },
    });
    expect(decide.statusCode).toBe(404);

    // The rightful guardian approves, so a withdraw attempt targets a decided consent.
    const approved = await app.inject({
      method: 'POST',
      url: `/parent-portal/consents/${otherConsentId}/decide`,
      headers: as(otherParent),
      payload: { status: 'approved' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const approvedId = (approved.json() as { id: string }).id;

    const withdraw = await app.inject({
      method: 'POST',
      url: `/parent-portal/consents/${approvedId}/withdraw`,
      headers: as(parent),
      payload: { reason: 'not my child' },
    });
    expect(withdraw.statusCode).toBe(404);

    const history = await app.inject({
      method: 'GET',
      url: `/parent-portal/consents/${approvedId}/history`,
      headers: as(parent),
    });
    expect(history.statusCode).toBe(404);

    const list = await app.inject({
      method: 'GET',
      url: '/parent-portal/consents',
      headers: as(parent),
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(0);
  });

  it('returns 404 when a tenant-B principal targets tenant-A consent ids', async () => {
    const consentId = await raiseConsent(PARENT_USER, CHILD);

    const decide = await app.inject({
      method: 'POST',
      url: `/parent-portal/consents/${consentId}/decide`,
      headers: as(tenantBParent, TENANT_B),
      payload: { status: 'approved' },
    });
    expect(decide.statusCode).toBe(404);

    const withdraw = await app.inject({
      method: 'POST',
      url: `/parent-portal/consents/${consentId}/withdraw`,
      headers: as(tenantBParent, TENANT_B),
      payload: {},
    });
    expect(withdraw.statusCode).toBe(404);

    const history = await app.inject({
      method: 'GET',
      url: `/parent-portal/consents/${consentId}/history`,
      headers: as(tenantBParent, TENANT_B),
    });
    expect(history.statusCode).toBe(404);

    const supersede = await app.inject({
      method: 'POST',
      url: `/parent-portal/consents/${consentId}/supersede`,
      headers: as(tenantBRegistrar, TENANT_B),
      payload: { consentVersion: 'photo-v2' },
    });
    expect(supersede.statusCode).toBe(404);

    // Tenant A's consent is untouched: the guardian can still decide it.
    const ownDecide = await app.inject({
      method: 'POST',
      url: `/parent-portal/consents/${consentId}/decide`,
      headers: as(parent),
      payload: { status: 'approved' },
    });
    expect(ownDecide.statusCode, ownDecide.body).toBe(200);
  });
});
