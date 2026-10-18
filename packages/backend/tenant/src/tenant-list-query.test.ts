/**
 * PRC-L167 — GET /tenants validates its list query and honours sort/pagination.
 *
 * The handler used to do `Number(query.page) || 1` and
 * `query.sortBy ?? 'createdAt'` with no whitelist or bound, so an out-of-range
 * pageSize or an injected sortBy reached the query layer unchecked. These
 * regression tests assert the handler now rejects bad input (400) and honours
 * a valid sort + pagination request.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import { registerTenantRoutes } from './routes.js';
import { RecordingAdminProvisioner } from './test-admin-provisioner.js';
import { TenantService } from './tenant-service.js';

const SLUGS = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];

async function seed(service: TenantService) {
  for (const slug of SLUGS) {
    await service.createTenant({
      name: slug.toUpperCase(),
      slug,
      admin: {
        firstName: 'Ad',
        lastName: 'Min',
        email: `admin@${slug}.test`,
        password: 'password123',
      },
    });
  }
}

describe('GET /tenants list-query validation (PRC-L167)', () => {
  let app: FastifyInstance;
  let service: TenantService;

  beforeEach(async () => {
    const repo = new InMemoryTenantRepository();
    service = new TenantService(repo, undefined, new RecordingAdminProvisioner());
    app = Fastify();
    await registerTenantRoutes(app, { tenantService: service });
    await app.ready();
    await seed(service);
  });

  it('rejects an out-of-range pageSize with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants?pageSize=9999' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('rejects page=0 with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants?page=0' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-enum sortBy (injection attempt) with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/tenants?sortBy=${encodeURIComponent(';DROP TABLE tenants')}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('honours a valid sortBy=name&sortOrder=asc', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants?sortBy=name&sortOrder=asc' });
    expect(res.statusCode).toBe(200);
    const names = res.json().data.map((t: { name: string }) => t.name);
    expect(names).toEqual([...names].sort());
  });

  it('honours the requested page/pageSize in the response meta', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants?page=2&pageSize=2' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.page).toBe(2);
    expect(body.meta.pageSize).toBe(2);
    expect(body.meta.totalItems).toBe(SLUGS.length);
    expect(body.data).toHaveLength(2);
  });
});
