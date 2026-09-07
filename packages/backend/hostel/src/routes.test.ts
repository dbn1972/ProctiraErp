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

  describe('POST /hostel/leaves', () => {
    it('should create a leave request', async () => {
      const hostel = await app.inject({
        method: 'POST',
        url: '/hostel',
        payload: { name: 'Leave Hall', code: 'LH-01' },
      });
      const hostelId = hostel.json().id as string;

      const response = await app.inject({
        method: 'POST',
        url: '/hostel/leaves',
        payload: {
          studentId: STUDENT_ID,
          hostelId,
          startDate: '2026-02-01',
          endDate: '2026-02-05',
          reason: 'Family visit',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe('pending');
    });
  });

  describe('POST /hostel/visitors', () => {
    it('should create a visitor entry', async () => {
      const hostel = await app.inject({
        method: 'POST',
        url: '/hostel',
        payload: { name: 'Visitor Hall', code: 'VH-01' },
      });
      const hostelId = hostel.json().id as string;

      const response = await app.inject({
        method: 'POST',
        url: '/hostel/visitors',
        payload: {
          hostelId,
          visitorName: 'Parent One',
          studentId: STUDENT_ID,
          visitDate: '2026-03-01',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().visitorName).toBe('Parent One');
    });
  });

  describe('block → room → bed chain', () => {
    it('should create block, room, and bed in sequence', async () => {
      const hostel = await app.inject({
        method: 'POST',
        url: '/hostel',
        payload: { name: 'Structure Hall', code: 'SH-01' },
      });
      const hostelId = hostel.json().id as string;

      const blockRes = await app.inject({
        method: 'POST',
        url: '/hostel/blocks',
        payload: { hostelId, name: 'Block A', floor: 1 },
      });
      expect(blockRes.statusCode).toBe(201);
      const block = blockRes.json();
      expect(block.name).toBe('Block A');
      expect(block.floor).toBe(1);
      expect(block.hostelId).toBe(hostelId);

      const roomRes = await app.inject({
        method: 'POST',
        url: '/hostel/rooms',
        payload: { blockId: block.id, roomNumber: '101', capacity: 2 },
      });
      expect(roomRes.statusCode).toBe(201);
      const room = roomRes.json();
      expect(room.roomNumber).toBe('101');
      expect(room.capacity).toBe(2);
      expect(room.blockId).toBe(block.id);

      const bedRes = await app.inject({
        method: 'POST',
        url: '/hostel/beds',
        payload: { roomId: room.id, bedLabel: 'A', isAvailable: true },
      });
      expect(bedRes.statusCode).toBe(201);
      const bed = bedRes.json();
      expect(bed.bedLabel).toBe('A');
      expect(bed.isAvailable).toBe(true);
      expect(bed.roomId).toBe(room.id);
    });
  });

  describe('GET /hostel/beds', () => {
    it('should list all beds for tenant when roomId is omitted', async () => {
      const hostel = await app.inject({
        method: 'POST',
        url: '/hostel',
        payload: { name: 'Bed List Hall', code: 'BL-01' },
      });
      const hostelId = hostel.json().id as string;

      const block = await app.inject({
        method: 'POST',
        url: '/hostel/blocks',
        payload: { hostelId, name: 'Block B' },
      });
      const blockId = block.json().id as string;

      const room = await app.inject({
        method: 'POST',
        url: '/hostel/rooms',
        payload: { blockId, roomNumber: '201' },
      });
      const roomId = room.json().id as string;

      await app.inject({
        method: 'POST',
        url: '/hostel/beds',
        payload: { roomId, bedLabel: 'B1' },
      });
      await app.inject({
        method: 'POST',
        url: '/hostel/beds',
        payload: { roomId, bedLabel: 'B2' },
      });

      const response = await app.inject({ method: 'GET', url: '/hostel/beds' });
      expect(response.statusCode).toBe(200);
      const beds = response.json().data as Array<{ bedLabel: string }>;
      expect(beds.length).toBeGreaterThanOrEqual(2);
      expect(beds.some((b) => b.bedLabel === 'B1')).toBe(true);
      expect(beds.some((b) => b.bedLabel === 'B2')).toBe(true);

      const filtered = await app.inject({
        method: 'GET',
        url: `/hostel/beds?roomId=${roomId}`,
      });
      expect(filtered.statusCode).toBe(200);
      expect(filtered.json().data).toHaveLength(2);
    });
  });
});
