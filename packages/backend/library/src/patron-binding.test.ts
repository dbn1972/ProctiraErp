/**
 * G-916 — portal reads of loans/holds are bound at the API, not only in the web tier.
 * Students are pinned to their JWT subject; parents may only name linked children;
 * staff principals are never bound.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryLibraryRepository } from './in-memory-repository.js';
import { libraryPlugin } from './library-plugin.js';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CHILD = '55555555-5555-4555-8555-555555555555';
const OTHER_CHILD = '66666666-6666-4666-8666-666666666666';
const PARENT_SUB = 'parent-1';

type Role = { roleId: string; roleName: string };

function build(user: { sub: string; roles: Role[] } | null) {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as { tenantId: string }).tenantId = TENANT_ID;
    (request as { user: unknown }).user = user;
  });
  return app;
}

async function seedLoans(app: FastifyInstance) {
  const item = await app.inject({
    method: 'POST',
    url: '/library/items',
    payload: { title: 'Bound Book', copies: 2 },
  });
  for (const studentId of [CHILD, OTHER_CHILD]) {
    const res = await app.inject({
      method: 'POST',
      url: '/library/circulation/checkout',
      payload: { itemId: item.json().id, studentId, dueAt: '2030-01-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(201);
  }
}

describe('G-916 patron binding on GET /library/loans and /library/holds', () => {
  const binding = {
    isLinked: async (_tenantId: string, parentUserId: string, studentId: string) =>
      parentUserId === PARENT_SUB && studentId === CHILD,
  };

  describe('parent', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      app = build({ sub: PARENT_SUB, roles: [{ roleId: 'parent', roleName: 'Parent' }] });
      await app.register(libraryPlugin, {
        repository: new InMemoryLibraryRepository(),
        patronBinding: binding,
      });
      await app.ready();
      await seedLoans(app);
    });

    it('reads loans for a linked child', async () => {
      const res = await app.inject({ method: 'GET', url: `/library/loans?studentId=${CHILD}` });
      expect(res.statusCode).toBe(200);
      const data = res.json().data as Array<{ studentId: string }>;
      expect(data).toHaveLength(1);
      expect(data[0]?.studentId).toBe(CHILD);
    });

    it('gets 404 (not a leak) for an unlinked student id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/library/loans?studentId=${OTHER_CHILD}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('cannot list the whole tenant by omitting studentId', async () => {
      const res = await app.inject({ method: 'GET', url: '/library/loans' });
      expect(res.statusCode).toBe(400);
      const holds = await app.inject({ method: 'GET', url: '/library/holds' });
      expect(holds.statusCode).toBe(400);
    });
  });

  it('student is pinned to the JWT subject', async () => {
    const app = build({ sub: CHILD, roles: [{ roleId: 'student', roleName: 'Student' }] });
    await app.register(libraryPlugin, {
      repository: new InMemoryLibraryRepository(),
      patronBinding: binding,
    });
    await app.ready();
    await seedLoans(app);

    const own = await app.inject({ method: 'GET', url: '/library/loans' });
    expect(own.statusCode).toBe(200);
    expect((own.json().data as Array<{ studentId: string }>).map((l) => l.studentId)).toEqual([
      CHILD,
    ]);

    const other = await app.inject({
      method: 'GET',
      url: `/library/loans?studentId=${OTHER_CHILD}`,
    });
    expect(other.statusCode).toBe(403);
  });

  it('staff principals are not bound', async () => {
    const app = build({
      sub: 'librarian-1',
      roles: [
        { roleId: 'parent', roleName: 'Parent' },
        { roleId: 'librarian', roleName: 'Librarian' },
      ],
    });
    await app.register(libraryPlugin, {
      repository: new InMemoryLibraryRepository(),
      patronBinding: binding,
    });
    await app.ready();
    await seedLoans(app);

    const res = await app.inject({ method: 'GET', url: '/library/loans' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });

  it('parent reads are refused when no binding is configured', async () => {
    const app = build({ sub: PARENT_SUB, roles: [{ roleId: 'guardian', roleName: 'Guardian' }] });
    await app.register(libraryPlugin, { repository: new InMemoryLibraryRepository() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: `/library/loans?studentId=${CHILD}` });
    expect(res.statusCode).toBe(403);
  });
});
