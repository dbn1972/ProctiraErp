/**
 * PRC-L117: hostel input validation. Date fields must be real calendar dates,
 * id query filters must be UUIDs, fee amounts must be integer minor units.
 * Each rejection is a 400 before the value can reach a PG `date` / `uuid` column.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostelPlugin } from './hostel-plugin.js';
import { InMemoryHostelRepository } from './in-memory-repository.js';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const HOSTEL_ID = '44444444-4444-4444-8444-444444444444';
const BLOCK_ID = '55555555-5555-4555-8555-555555555555';

describe('PRC-L117 hostel input validation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string; user?: { roles: string[] } }).tenantId = TENANT_ID;
      (request as { tenantId: string; user?: { roles: string[] } }).user = { roles: ['warden'] };
    });
    await app.register(hostelPlugin, { repository: new InMemoryHostelRepository() });
    await app.ready();
  });

  it.each(['2026-02-31', '2026-13-01', 'abcdefghij', '2026/01/01'])(
    'rejects leave startDate %s with 400',
    async (startDate) => {
      const response = await app.inject({
        method: 'POST',
        url: '/hostel/leaves',
        payload: { studentId: STUDENT_ID, hostelId: HOSTEL_ID, startDate, endDate: '2026-03-05' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('VALIDATION_ERROR');
    },
  );

  it('rejects an impossible visitDate with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/hostel/visitors',
      payload: {
        hostelId: HOSTEL_ID,
        visitorName: 'Guardian',
        studentId: STUDENT_ID,
        visitDate: '2026-04-31',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it.each([
    '/hostel/blocks?hostelId=not-a-uuid',
    '/hostel/rooms?blockId=1',
    '/hostel/beds?roomId=abc',
    '/hostel/mess/plans?hostelId=x',
    '/hostel/mess/menu?planId=x',
    '/hostel/mess/subscriptions?planId=x',
    '/hostel/gate-passes?hostelId=x',
    `/hostel/attendance?blockId=x&onDate=2026-03-01`,
    `/hostel/attendance?blockId=${BLOCK_ID}&onDate=2026-02-30`,
  ])('rejects malformed query on GET %s with 400', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('still lists with a well-formed uuid filter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/hostel/blocks?hostelId=${HOSTEL_ID}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
  });

  it('rejects a fractional-cent fee amount with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/hostel/fee-structures',
      payload: { hostelId: HOSTEL_ID, roomType: 'double', termLabel: 'T1', amountCents: 100.5 },
    });
    expect(response.statusCode).toBe(400);
  });
});
