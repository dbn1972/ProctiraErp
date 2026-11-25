/**
 * PRC-M538: guardian admission offers are matched by the token email, so the
 * family portal uses that email only when the IdP asserted it as verified
 * (`email_verified === true`). An unverified or absent claim gets 400
 * EMAIL_REQUIRED and the offers port is never asked.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdmissionsOffersPort } from './admissions-offers-port.js';
import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const OFFER_ID = '00000000-0000-4000-8000-0000000000f1';
const GUARDIAN_EMAIL = 'ravi@example.test';

interface Principal {
  sub: string;
  email?: string;
  email_verified?: unknown;
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }>;
}

describe('PRC-M538 guardian offers need a verified email', () => {
  let app: FastifyInstance;
  let asked: string[];

  beforeEach(async () => {
    asked = [];
    const admissionsOffers: AdmissionsOffersPort = {
      listGuardianOffers: async (_tenantId, email) => {
        asked.push(`list:${email}`);
        return [];
      },
      acceptOfferForGuardian: async (_tenantId, offerId, email) => {
        asked.push(`accept:${email}`);
        return {
          id: offerId,
          applicationId: 'app-1',
          status: 'accepted',
          feeAmount: 0,
          feeCurrency: 'INR',
          paymentRef: null,
          offerFeeInvoiceId: null,
          enrolledStudentId: null,
          expiresAt: null,
          applicantFirstName: 'A',
          applicantLastName: 'R',
          guardianEmail: email,
        };
      },
    };
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null as unknown as Principal);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      const principal = request.headers['x-test-principal'];
      (request as unknown as { user: Principal | null }).user =
        typeof principal === 'string' ? (JSON.parse(principal) as Principal) : null;
    });
    await app.register(parentPortalPlugin, {
      repository: new InMemoryParentPortalRepository(),
      admissionsOffers,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const guardian = (emailVerified: unknown): Principal => ({
    sub: 'guardian-1',
    email: GUARDIAN_EMAIL,
    ...(emailVerified === undefined ? {} : { email_verified: emailVerified }),
    roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
  });
  const as = (p: Principal) => ({ 'x-test-principal': JSON.stringify(p) });

  it.each([[undefined], [false], ['true']])(
    'email_verified=%s: list and accept are refused (400) and the port is not asked',
    async (emailVerified) => {
      const list = await app.inject({
        method: 'GET',
        url: '/parent-portal/offers',
        headers: as(guardian(emailVerified)),
      });
      expect(list.statusCode).toBe(400);
      expect(list.json()).toMatchObject({ code: 'EMAIL_REQUIRED' });
      const accept = await app.inject({
        method: 'POST',
        url: `/parent-portal/offers/${OFFER_ID}/accept`,
        headers: as(guardian(emailVerified)),
        payload: {},
      });
      expect(accept.statusCode).toBe(400);
      expect(accept.json()).toMatchObject({ code: 'EMAIL_REQUIRED' });
      expect(asked).toEqual([]);
    },
  );

  it('a verified email is used for matching', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/parent-portal/offers',
      headers: as(guardian(true)),
    });
    expect(list.statusCode).toBe(200);
    expect(asked).toEqual([`list:${GUARDIAN_EMAIL}`]);
  });
});
