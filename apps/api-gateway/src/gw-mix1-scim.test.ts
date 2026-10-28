/**
 * PRC-M025 / PRC-M026 — SCIM PUT/PATCH honour profile attributes (Okta/Entra
 * shaped payloads), unsupported paths are rejected, Users/:id is a single-row
 * lookup and concurrent group PATCHes for one user keep both roles.
 */
import { InMemoryRolesRepository, RolesService } from '@proctira/backend-tenant';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestConfig } from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';
import { scimPlugin, userChangeFromPatch } from './scim-plugin.js';

delete process.env['DATABASE_URL'];

const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';

describe('SCIM profile writes and atomic groups', () => {
  let app: FastifyInstance;
  let headers: Record<string, string>;
  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
    // PRC-M027: SCIM calls authenticate with a dedicated token issued by a tenant admin.
    const issued = await app.inject({
      method: 'POST',
      url: '/api/v1/tenant/scim-token',
      headers: authHeaders(app, { roles: ['admin'] }),
    });
    expect(issued.statusCode, issued.body).toBe(201);
    headers = {
      authorization: `Bearer ${(issued.json() as { token: string }).token}`,
      'content-type': 'application/scim+json',
    };
  });
  afterAll(async () => {
    await app.close();
  });

  const createUser = async (email: string, externalId?: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/scim/v2/Users',
      headers,
      payload: JSON.stringify({
        schemas: [USER],
        userName: email,
        displayName: 'Original Name',
        ...(externalId ? { externalId } : {}),
      }),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string; externalId?: string };
  };
  const patchUser = (id: string, Operations: unknown[]) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/scim/v2/Users/${id}`,
      headers,
      payload: JSON.stringify({ schemas: [PATCH], Operations }),
    });

  it('Okta-style PUT renames, changes e-mail and persists externalId', async () => {
    const user = await createUser('okta.user@school.org', 'okta-00u1');
    expect(user.externalId).toBe('okta-00u1');
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/scim/v2/Users/${user.id}`,
      headers,
      payload: JSON.stringify({
        schemas: [USER],
        userName: 'okta.renamed@school.org',
        name: { formatted: 'Renamed Person' },
        emails: [{ value: 'okta.renamed@school.org', primary: true, type: 'work' }],
        externalId: 'okta-00u1',
        active: true,
      }),
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toMatchObject({
      userName: 'okta.renamed@school.org',
      displayName: 'Renamed Person',
      externalId: 'okta-00u1',
    });
    const byExternal = await app.inject({
      method: 'GET',
      url: `/api/v1/scim/v2/Users?filter=${encodeURIComponent('externalId eq "okta-00u1"')}`,
      headers,
    });
    expect(byExternal.json().totalResults).toBe(1);
  });

  it('Entra-style PATCH replaces displayName, email and given/family name', async () => {
    const user = await createUser('entra.user@school.org');
    const res = await patchUser(user.id, [
      { op: 'Replace', path: 'displayName', value: 'Entra Display' },
      { op: 'Replace', path: 'emails[type eq "work"].value', value: 'entra.new@school.org' },
      { op: 'Replace', path: 'name.familyName', value: 'Surname' },
      { op: 'Add', path: 'externalId', value: 'entra-oid-1' },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      displayName: 'Entra Surname',
      userName: 'entra.new@school.org',
      externalId: 'entra-oid-1',
    });
  });

  it('unsupported PATCH path → 400 scimType invalidPath (no silent 200)', async () => {
    const user = await createUser('unsupported.path@school.org');
    const res = await patchUser(user.id, [{ op: 'replace', path: 'title', value: 'Teacher' }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().scimType).toBe('invalidPath');
    const groupRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scim/v2/Groups/${(await firstGroups(1))[0]!.id}`,
      headers,
      payload: JSON.stringify({
        schemas: [PATCH],
        Operations: [{ op: 'replace', path: 'description', value: 'x' }],
      }),
    });
    expect(groupRes.statusCode).toBe(400);
    expect(groupRes.json().scimType).toBe('invalidPath');
  });

  async function firstGroups(n: number): Promise<Array<{ id: string; displayName: string }>> {
    const groups = await app.inject({ method: 'GET', url: '/api/v1/scim/v2/Groups', headers });
    return (groups.json().Resources as Array<{ id: string; displayName: string }>).slice(0, n);
  }

  it('concurrent PATCH of two groups for the same user keeps both roles (PRC-M026)', async () => {
    const user = await createUser('two.groups@school.org');
    const [g1, g2] = await firstGroups(2);
    const add = (groupId: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/scim/v2/Groups/${groupId}`,
        headers,
        payload: JSON.stringify({
          schemas: [PATCH],
          Operations: [{ op: 'add', path: 'members', value: [{ value: user.id }] }],
        }),
      });
    const [a, b] = await Promise.all([add(g1!.id), add(g2!.id)]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/scim/v2/Users/${user.id}`,
      headers,
    });
    const groupIds = (got.json().groups as Array<{ value: string }>).map((g) => g.value);
    expect(groupIds).toEqual(expect.arrayContaining([g1!.id, g2!.id]));
  });
});

describe('userChangeFromPatch (PRC-M025)', () => {
  it('maps value-object replaces and rejects unknown attributes', () => {
    expect(
      userChangeFromPatch(
        [{ op: 'replace', value: { active: 'False', displayName: 'X Y', userName: 'a@b.co' } }],
        { displayName: 'Old' },
      ),
    ).toEqual({ active: false, displayName: 'X Y', email: 'a@b.co' });
    expect(() =>
      userChangeFromPatch([{ op: 'replace', value: { nickName: 'z' } }], { displayName: 'Old' }),
    ).toThrow(/Unsupported attribute path/);
  });
});

describe('PRC-M026 SCIM list/filter never scans the tenant directory', () => {
  const TENANT = '550e8400-e29b-41d4-a716-44665544a026';
  const OTHER = '660e8400-e29b-41d4-a716-44665544a026';

  /** Counts directory-wide scans (listUsers) vs store-evaluated queries. */
  class CountingRepository extends InMemoryRolesRepository {
    listUsersCalls = 0;
    queryUsersCalls = 0;
    override async listUsers(...args: Parameters<InMemoryRolesRepository['listUsers']>) {
      this.listUsersCalls += 1;
      return super.listUsers(...args);
    }
    override async queryUsers(...args: Parameters<InMemoryRolesRepository['queryUsers']>) {
      this.queryUsersCalls += 1;
      return super.queryUsers(...args);
    }
  }

  let app: FastifyInstance;
  let repo: CountingRepository;
  let service: RolesService;
  let memberRoleId = '';
  const scimHeaders = { 'content-type': 'application/scim+json' };

  beforeAll(async () => {
    repo = new CountingRepository([
      { roleId: 'teacher', roleName: 'Teacher', permissions: [] },
      { roleId: 'staff', roleName: 'Staff', permissions: [] },
    ]);
    service = new RolesService(repo);
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId =
        (request.headers['x-test-tenant'] as string | undefined) ?? TENANT;
    });
    await app.register(scimPlugin, { rolesService: service });
    await app.ready();
    const roles = await service.listRoles(TENANT);
    memberRoleId = roles[0]!.id;
    for (let i = 0; i < 5; i += 1) {
      await service.inviteUser(TENANT, {
        email: `m026.user${i}@school.org`,
        displayName: `M026 User ${i}`,
        roleIds: i % 2 === 0 ? [roles[0]!.id] : [],
      });
    }
    await service.inviteUser(OTHER, {
      email: 'm026.user0@other.org',
      displayName: 'Other Tenant',
      roleIds: [],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const reset = () => {
    repo.listUsersCalls = 0;
    repo.queryUsersCalls = 0;
  };

  it('userName eq filter is one store query, no directory scan', async () => {
    reset();
    const res = await app.inject({
      method: 'GET',
      url: `/scim/v2/Users?filter=${encodeURIComponent('userName eq "M026.USER3@school.org"')}`,
      headers: scimHeaders,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ totalResults: 1, itemsPerPage: 1 });
    expect(res.json().Resources[0].userName).toBe('m026.user3@school.org');
    expect(repo.listUsersCalls).toBe(0);
    expect(repo.queryUsersCalls).toBe(1);
  });

  it('startIndex/count page through the store window with the real total', async () => {
    reset();
    const res = await app.inject({
      method: 'GET',
      url: '/scim/v2/Users?startIndex=2&count=2',
      headers: scimHeaders,
    });
    expect(res.json()).toMatchObject({ totalResults: 5, startIndex: 2, itemsPerPage: 2 });
    expect(res.json().Resources.map((u: { displayName: string }) => u.displayName)).toEqual([
      'M026 User 1',
      'M026 User 2',
    ]);
    expect(repo.listUsersCalls).toBe(0);
  });

  it('GET /Groups resolves members per role without a directory scan', async () => {
    reset();
    const res = await app.inject({ method: 'GET', url: '/scim/v2/Groups', headers: scimHeaders });
    expect(res.statusCode).toBe(200);
    const group = (res.json().Resources as Array<{ id: string; members: unknown[] }>).find(
      (g) => g.id === memberRoleId,
    );
    expect(group?.members).toHaveLength(3);
    expect(repo.listUsersCalls).toBe(0);
  });

  it('filters stay inside the request tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/scim/v2/Users?filter=${encodeURIComponent('userName eq "m026.user0@other.org"')}`,
      headers: scimHeaders,
    });
    expect(res.json().totalResults).toBe(0);
  });
});
