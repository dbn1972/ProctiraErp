/**
 * Transport Routes Integration Tests
 *
 * Tests HTTP endpoints for transport route, vehicle,
 * driver assignment, and student assignment management.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { transportPlugin } from './transport-plugin.js';
import { InMemoryTransportRepository } from './in-memory-repository.js';

describe('Transport Routes', () => {
  let app: FastifyInstance;
  const tenantId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(async () => {
    app = Fastify();

    // Add tenantId decorator to simulate tenant resolution
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as any).tenantId = tenantId;
    });

    const repository = new InMemoryTransportRepository();
    await app.register(transportPlugin, { repository });
    await app.ready();
  });

  // ─── Route Endpoints ─────────────────────────────────────────────────

  describe('POST /transport/routes', () => {
    it('should create a transport route', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/transport/routes',
        payload: {
          name: 'Route A',
          startLocation: 'School',
          endLocation: 'Town',
          operatingDays: ['monday', 'wednesday', 'friday'],
          departureTime: '07:30',
          returnTime: '15:30',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('Route A');
      expect(body.status).toBe('active');
      expect(body.operatingDays).toHaveLength(3);
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/transport/routes',
        payload: {
          name: '',
          startLocation: 'School',
          endLocation: 'Town',
          operatingDays: [],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /transport/routes', () => {
    it('should list transport routes', async () => {
      await app.inject({
        method: 'POST',
        url: '/transport/routes',
        payload: {
          name: 'Route 1',
          startLocation: 'A',
          endLocation: 'B',
          operatingDays: ['monday'],
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/transport/routes',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.meta.totalItems).toBe(1);
    });
  });

  describe('GET /transport/routes/:id', () => {
    it('should get a route by ID', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/transport/routes',
        payload: {
          name: 'Route X',
          startLocation: 'A',
          endLocation: 'B',
          operatingDays: ['monday'],
        },
      });
      const created = createRes.json();

      const response = await app.inject({
        method: 'GET',
        url: `/transport/routes/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Route X');
    });

    it('should return 404 for non-existent route', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/transport/routes/550e8400-e29b-41d4-a716-446655440099',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Vehicle Endpoints ───────────────────────────────────────────────

  describe('POST /transport/vehicles', () => {
    it('should create a vehicle', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/transport/vehicles',
        payload: {
          registrationNumber: 'ABC-1234',
          make: 'Toyota',
          model: 'HiAce',
          year: 2022,
          capacity: 30,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.registrationNumber).toBe('ABC-1234');
      expect(body.status).toBe('active');
    });

    it('should reject duplicate registration number', async () => {
      await app.inject({
        method: 'POST',
        url: '/transport/vehicles',
        payload: { registrationNumber: 'DUP-001', capacity: 30 },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/transport/vehicles',
        payload: { registrationNumber: 'DUP-001', capacity: 20 },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  // ─── Driver Assignment Endpoints ─────────────────────────────────────

  describe('POST /transport/driver-assignments', () => {
    it('should create a driver assignment', async () => {
      const vehicleRes = await app.inject({
        method: 'POST',
        url: '/transport/vehicles',
        payload: { registrationNumber: 'DRV-001', capacity: 30 },
      });
      const vehicle = vehicleRes.json();

      const response = await app.inject({
        method: 'POST',
        url: '/transport/driver-assignments',
        payload: {
          vehicleId: vehicle.id,
          driverId: '550e8400-e29b-41d4-a716-446655440001',
          startDate: '2024-01-01',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.vehicleId).toBe(vehicle.id);
      expect(body.isActive).toBe(true);
    });
  });

  // ─── Student Assignment Endpoints ────────────────────────────────────

  describe('POST /transport/student-assignments', () => {
    it('should assign a student to a route', async () => {
      const routeRes = await app.inject({
        method: 'POST',
        url: '/transport/routes',
        payload: {
          name: 'Route S',
          startLocation: 'A',
          endLocation: 'B',
          operatingDays: ['monday'],
        },
      });
      const route = routeRes.json();

      const response = await app.inject({
        method: 'POST',
        url: '/transport/student-assignments',
        payload: {
          studentId: '550e8400-e29b-41d4-a716-446655440002',
          routeId: route.id,
          startDate: '2024-01-15',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.routeId).toBe(route.id);
      expect(body.isActive).toBe(true);
    });
  });
});
