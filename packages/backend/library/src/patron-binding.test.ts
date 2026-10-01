/**
 * G-916 — portal reads of loans/holds are bound at the API, not only in the web tier.
 * Students are pinned to their JWT subject; parents may only name linked children;
 * staff principals are never bound.
 *
 * W1-SEC-02: mutating seed runs as librarian; portal principals only get bound GETs.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryLibraryRepository } from './in-memory-repository.js';
import type { LibraryRepository } from './library-repository.js';
import { libraryPlugin } from './library-plugin.js';
import type { PatronBinding } from './routes.js';

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

async function seedLoans(repository: LibraryRepository, binding: PatronBinding) {
  const app = build({
    sub: 'librarian-seed',
    roles: [{ roleId: 'librarian', roleName: 'Librarian' }],
  });
  await app.register(libraryPlugin, { repository, patronBinding: binding });
  await app.ready();
  const item = await app.inject({
    method: 'POST',
    url: '/library/items',
    payload: { title: 'Bound Book', copies: 2 },
  });
  expect(item.statusCode).toBe(201);
  for (const studentId of [CHILD, OTHER_CHILD]) {
    const res = await app.inject({
      method: 'POST',
      url: '/library/circulation/checkout',
      payload: { itemId: item.json().id, studentId, dueAt: '2030-01-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(201);
  }
  await app.close();
}

describe('G-916 patron binding on GET /library/loans and /library/holds', () => {
  const binding: PatronBinding = {
    isLinked: async (_tenantId: string, parentUserId: string, studentId: string) =>
      parentUserId === PARENT_SUB && studentId === CHILD,
  };

  describe('parent', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      const repository = new InMemoryLibraryRepository();
      await seedLoans(repository, binding);
      app = build({ sub: PARENT_SUB, roles: [{ roleId: 'parent', roleName: 'Parent' }] });
      await app.register(libraryPlugin, { repository, patronBinding: binding });
      await app.ready();
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

    it('cannot mutate catalog as parent (W1-SEC-02)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/library/items',
        payload: { title: 'Sneaky', copies: 1 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  it('student is pinned to the JWT subject', async () => {
    const repository = new InMemoryLibraryRepository();
    await seedLoans(repository, binding);
    const app = build({ sub: CHILD, roles: [{ roleId: 'student', roleName: 'Student' }] });
    await app.register(libraryPlugin, { repository, patronBinding: binding });
    await app.ready();

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
    const repository = new InMemoryLibraryRepository();
    await seedLoans(repository, binding);
    const app = build({
      sub: 'librarian-1',
      roles: [
        { roleId: 'parent', roleName: 'Parent' },
        { roleId: 'librarian', roleName: 'Librarian' },
      ],
    });
    await app.register(libraryPlugin, { repository, patronBinding: binding });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/library/loans' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });

  it('parent reads are refused when no binding is configured', async () => {
    const repository = new InMemoryLibraryRepository();
    await seedLoans(repository, binding);
    const app = build({ sub: PARENT_SUB, roles: [{ roleId: 'guardian', roleName: 'Guardian' }] });
    await app.register(libraryPlugin, { repository });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: `/library/loans?studentId=${CHILD}` });
    expect(res.statusCode).toBe(403);
  });
});

// ─── PRC-H067/H068: fines/overdues/clearance scoping + hybrid-role bypass ──────

describe('PRC-H067/H068 library read scoping', () => {
  const binding: PatronBinding = {
    isLinked: async (_t: string, parentUserId: string, studentId: string) =>
      parentUserId === PARENT_SUB && studentId === CHILD,
  };

  async function appAs(user: { sub: string; roles: Role[] }, withBinding = true) {
    const repository = new InMemoryLibraryRepository();
    await seedLoans(repository, binding);
    const app = build(user);
    await app.register(libraryPlugin, {
      repository,
      ...(withBinding ? { patronBinding: binding } : {}),
    });
    await app.ready();
    return app;
  }

  it('H067: student cannot read tenant-wide overdues or fine policy (403)', async () => {
    const app = await appAs({ sub: CHILD, roles: [{ roleId: 'student', roleName: 'Student' }] });
    expect((await app.inject({ method: 'GET', url: '/library/overdues' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/library/fines/policy' })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/library/copies/by-barcode?barcode=X' })).statusCode,
    ).toBe(403);
    await app.close();
  });

  it('H067: student /fines is scoped to self; cannot read another student', async () => {
    const app = await appAs({ sub: CHILD, roles: [{ roleId: 'student', roleName: 'Student' }] });
    // Own fines (studentId omitted → pinned to self) → 200.
    const own = await app.inject({ method: 'GET', url: '/library/fines' });
    expect(own.statusCode).toBe(200);
    // Another student's fines → 403.
    const other = await app.inject({
      method: 'GET',
      url: `/library/fines?studentId=${OTHER_CHILD}`,
    });
    expect(other.statusCode).toBe(403);
    await app.close();
  });

  it('H067: parent /fines is linked-child 200, unlinked 404, no-studentId 400', async () => {
    const app = await appAs({ sub: PARENT_SUB, roles: [{ roleId: 'guardian', roleName: 'Guardian' }] });
    const own = await app.inject({ method: 'GET', url: `/library/fines?studentId=${CHILD}` });
    expect(own.statusCode).toBe(200);
    const other = await app.inject({
      method: 'GET',
      url: `/library/fines?studentId=${OTHER_CHILD}`,
    });
    expect(other.statusCode).toBe(404);
    const none = await app.inject({ method: 'GET', url: '/library/fines' });
    expect(none.statusCode).toBe(400);
    await app.close();
  });

  it('H067: parent clearance is bound — linked child 200, unlinked 404', async () => {
    const app = await appAs({ sub: PARENT_SUB, roles: [{ roleId: 'guardian', roleName: 'Guardian' }] });
    const own = await app.inject({ method: 'GET', url: `/library/patrons/${CHILD}/clearance` });
    expect(own.statusCode).toBe(200);
    const other = await app.inject({
      method: 'GET',
      url: `/library/patrons/${OTHER_CHILD}/clearance`,
    });
    expect(other.statusCode).toBe(404);
    await app.close();
  });

  it('H068: guardian+teacher (no library staff role) stays BOUND, not unbound staff', async () => {
    // Pre-fix, any non-portal role made portalScope treat the caller as unbound staff.
    const app = await appAs({
      sub: PARENT_SUB,
      roles: [
        { roleId: 'guardian', roleName: 'Guardian' },
        { roleId: 'teacher', roleName: 'Teacher' },
      ],
    });
    // Unlinked child → 404 (bound as parent), not the whole tenant.
    const unlinked = await app.inject({
      method: 'GET',
      url: `/library/loans?studentId=${OTHER_CHILD}`,
    });
    expect(unlinked.statusCode).toBe(404);
    // Linked child → only that child's rows.
    const linked = await app.inject({ method: 'GET', url: `/library/loans?studentId=${CHILD}` });
    expect(linked.statusCode).toBe(200);
    expect((linked.json().data as unknown[]).length).toBe(1);
    await app.close();
  });

  it('H068: guardian+librarian (real library staff) remains unbound', async () => {
    const app = await appAs({
      sub: 'lib-guardian',
      roles: [
        { roleId: 'guardian', roleName: 'Guardian' },
        { roleId: 'librarian', roleName: 'Librarian' },
      ],
    });
    // Staff may read tenant-wide overdues.
    const overdues = await app.inject({ method: 'GET', url: '/library/overdues' });
    expect(overdues.statusCode).toBe(200);
    await app.close();
  });
});
