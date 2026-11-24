/**
 * HN-F4-R4: staff identity numbers are searchable only by roles allowed to see them.
 *
 * GET /staff masks `identityNumber` unless the caller holds `staff.update`
 * (PRC-L362), but the search still matched the full number, so a finance role
 * could confirm whose government ID it holds. HR writers keep the match.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffService } from './staff-service.js';
import { registerStaffRoutes } from './routes.js';

const TENANT_ID = '0d3c2b1a-9e8f-4a7b-8c6d-5e4f3a2b1c0d';
const IDENTITY = 'AAD-4821-9937-6605';

describe('staff search: identity number match is role-gated (HN-F4-R4)', () => {
  let app: FastifyInstance;
  let roles: string[];

  beforeEach(async () => {
    roles = ['hr_officer'];
    app = Fastify();
    const service = new StaffService(new InMemoryStaffRepository());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles };
    });
    await registerStaffRoutes(app, { staffService: service });
    await app.ready();
    for (const [firstName, identityNumber] of [
      ['Meera', IDENTITY],
      ['Arjun', 'AAD-1111-2222-3333'],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/staff',
        payload: {
          firstName,
          lastName: 'Rao',
          dateOfBirth: '1986-02-11',
          identityNumber,
          contactPhone: '+911234567890',
          position: 'Teacher',
        },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  const listBy = async (search: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/staff?search=${encodeURIComponent(search)}`,
    });
    expect(res.statusCode).toBe(200);
    return res.json().data as Array<{ firstName: string; identityNumber: string }>;
  };

  for (const role of ['bursar', 'finance_officer']) {
    it(`${role}: identity number search finds nobody`, async () => {
      roles = [role];
      expect(await listBy(IDENTITY)).toEqual([]);
      expect(await listBy('9937')).toEqual([]);
    });

    it(`${role}: name search still works and identity stays masked`, async () => {
      roles = [role];
      const rows = await listBy('meera');
      expect(rows.map((s) => s.firstName)).toEqual(['Meera']);
      expect(rows[0]!.identityNumber).not.toBe(IDENTITY);
    });
  }

  for (const role of ['hr_officer', 'admin']) {
    it(`${role}: identity number search still finds the staff member`, async () => {
      roles = [role];
      const rows = await listBy('9937');
      expect(rows.map((s) => s.identityNumber)).toEqual([IDENTITY]);
    });
  }
});
