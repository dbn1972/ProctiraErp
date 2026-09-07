/**
 * Hostel routes integration tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { hostelPlugin } from './hostel-plugin.js';
import { InMemoryHostelRepository } from './in-memory-repository.js';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const BED_ID = '44444444-4444-4444-8444-444444444444';

describe('Hostel Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string }).tenantId = TENANT_ID;
    });

    await app.register(hostelPlugin, { repository: new InMemoryHostelRepository() });
    await app.ready();
  });

  describe('POST /hostel', () => {
    it('should create a hostel', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hostel',
        payload: {
          name: 'North Hall',
          code: 'NH-01',
          capacity: 120,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('North Hall');
      expect(body.status).toBe('active');
    });
  });

  describe('GET /hostel', () => {
    it('should list hostels', async () => {
      await app.inject({
        method: 'POST',
        url: '/hostel',
        payload: { name: 'East Wing', code: 'EW-01' },
      });

      const response = await app.inject({ method: 'GET', url: '/hostel' });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
    });
  });

  describe('POST /hostel/assignments', () => {
    it('should create an assignment', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/hostel/assignments',
        payload: {
          studentId: STUDENT_ID,
          bedId: BED_ID,
          startDate: '2026-01-15',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().studentId).toBe(STUDENT_ID);
    });
  });
});
