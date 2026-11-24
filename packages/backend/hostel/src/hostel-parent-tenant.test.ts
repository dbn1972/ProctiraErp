/**
 * H-D3 — a hostel write that names a parent (hostel, block, room) must resolve
 * that parent inside the caller's tenant. In-memory repository, always runs.
 *
 * Before the fix: tenant A's POST /hostel/visitors, /blocks and /leaves with
 * tenant B's hostelId, /rooms with B's blockId and /beds with B's roomId all
 * return 201 (RED). After: 404 NOT_FOUND, with the same body as for an id that
 * does not exist anywhere (no existence oracle), and A's own writes stay 201.
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostelPlugin } from './hostel-plugin.js';
import { InMemoryHostelRepository } from './in-memory-repository.js';

const TENANT_A = '00000000-0000-4000-8000-0000000000a3';
const TENANT_B = '00000000-0000-4000-8000-0000000000b3';
const STUDENT_A = '00000000-0000-4000-8000-00000000a501';

type Tree = { hostelId: string; blockId: string; roomId: string };
type Parent = keyof Tree;

async function buildApp(repository: InMemoryHostelRepository, tenantId: string) {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as { tenantId?: string; user?: { sub: string; roles: string[] } }).tenantId = tenantId;
    (request as { tenantId?: string; user?: { sub: string; roles: string[] } }).user = {
      sub: 'h-d3-unit',
      roles: ['warden'],
    };
  });
  await app.register(hostelPlugin, { repository, prefix: '/hostel' });
  await app.ready();
  return app;
}

async function post(app: FastifyInstance, url: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url, payload });
}

async function buildTree(app: FastifyInstance, label: string): Promise<Tree> {
  const hostel = await post(app, '/hostel', { name: `${label} Hall`, code: label, capacity: 10 });
  expect(hostel.statusCode).toBe(201);
  const hostelId = hostel.json().id as string;
  const block = await post(app, '/hostel/blocks', { hostelId, name: `${label}-B` });
  expect(block.statusCode).toBe(201);
  const blockId = block.json().id as string;
  const room = await post(app, '/hostel/rooms', { blockId, roomNumber: `${label}-101` });
  expect(room.statusCode).toBe(201);
  return { hostelId, blockId, roomId: room.json().id as string };
}

const CASES: {
  url: string;
  parent: Parent;
  label: string;
  body: (id: string) => Record<string, unknown>;
}[] = [
  {
    url: '/hostel/visitors',
    parent: 'hostelId',
    label: 'Hostel',
    body: (hostelId) => ({
      hostelId,
      visitorName: 'Visitor',
      studentId: STUDENT_A,
      visitDate: '2026-11-20',
    }),
  },
  {
    url: '/hostel/blocks',
    parent: 'hostelId',
    label: 'Hostel',
    body: (hostelId) => ({ hostelId, name: `blk-${randomUUID().slice(0, 8)}` }),
  },
  {
    url: '/hostel/leaves',
    parent: 'hostelId',
    label: 'Hostel',
    body: (hostelId) => ({
      hostelId,
      studentId: STUDENT_A,
      startDate: '2026-11-20',
      endDate: '2026-11-22',
    }),
  },
  {
    url: '/hostel/rooms',
    parent: 'blockId',
    label: 'Block',
    body: (blockId) => ({ blockId, roomNumber: `r-${randomUUID().slice(0, 8)}` }),
  },
  {
    url: '/hostel/beds',
    parent: 'roomId',
    label: 'Room',
    body: (roomId) => ({ roomId, bedLabel: `b-${randomUUID().slice(0, 8)}` }),
  },
];

describe('H-D3 hostel parent references stay inside the caller tenant (in-memory)', () => {
  const repository = new InMemoryHostelRepository();
  let appA: FastifyInstance;
  let appB: FastifyInstance;
  let treeA: Tree;
  let treeB: Tree;

  beforeAll(async () => {
    appA = await buildApp(repository, TENANT_A);
    appB = await buildApp(repository, TENANT_B);
    treeA = await buildTree(appA, 'HD3A');
    treeB = await buildTree(appB, 'HD3B');
  });

  afterAll(async () => {
    await appA.close();
    await appB.close();
  });

  for (const c of CASES) {
    it(`POST ${c.url} with the caller's own ${c.parent} returns 201`, async () => {
      const res = await post(appA, c.url, c.body(treeA[c.parent]));
      expect(res.statusCode).toBe(201);
    });

    it(`POST ${c.url} with another tenant's ${c.parent} returns the not-found 404`, async () => {
      const foreignId = treeB[c.parent];
      const res = await post(appA, c.url, c.body(foreignId));
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        code: 'NOT_FOUND',
        statusCode: 404,
        message: `${c.label} with id '${foreignId}' not found`,
      });
    });

    it(`POST ${c.url}: another tenant's ${c.parent} and a random id answer the same`, async () => {
      const foreignId = treeB[c.parent];
      const randomId = randomUUID();
      const foreign = await post(appA, c.url, c.body(foreignId));
      const random = await post(appA, c.url, c.body(randomId));
      expect(foreign.statusCode).toBe(random.statusCode);
      expect(foreign.body.replaceAll(foreignId, '<id>')).toBe(
        random.body.replaceAll(randomId, '<id>'),
      );
    });
  }
});
