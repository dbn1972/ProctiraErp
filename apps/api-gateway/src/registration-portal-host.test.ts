/**
 * PRC-H113: the registration portal's server-side transport forwards the applicant's public
 * hostname as `Host` (resolvePublicHost: first X-Forwarded-Host hop, else Host). Through the real
 * gateway, two tenant hostnames must return different institution lists; forwarding headers sent
 * to the gateway itself are ignored; an unknown host is a not-found state, never a default tenant.
 */
import { randomUUID } from 'node:crypto';
import {
  createPublicTenantResolver,
  InMemoryTenantRepository,
  type TenantEntity,
} from '@proctira/backend-tenant';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GatewayConfig } from './config.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SCHOOL_A = randomUUID();
const SCHOOL_B = randomUUID();

const seeded = vi.hoisted(() => ({ tenants: { a: '', b: '' }, schools: { a: '', b: '' } }));
vi.mock('@proctira/backend-registration', async (orig) => {
  const mod = await orig<typeof import('@proctira/backend-registration')>();
  const repository = new mod.InMemoryRegistrationRepository();
  const school = (id: string, tenantId: string, name: string) => ({
    id,
    tenantId,
    name,
    code: name.slice(0, 3).toUpperCase(),
    typeId: 'type-1',
    areaId: 'area-1',
    status: 'ACTIVE',
    latitude: null,
    longitude: null,
    address: null,
  });
  return {
    ...mod,
    createRegistrationRepository: () => {
      repository.seedInstitutions([
        school(seeded.schools.a, seeded.tenants.a, 'Alpha School'),
        school(seeded.schools.b, seeded.tenants.b, 'Beta School'),
      ]);
      return repository;
    },
  };
});

function tenant(id: string, slug: string) {
  return {
    id,
    name: slug,
    slug,
    status: 'active',
    plan: null,
    region: null,
    config: {},
    suspendedAt: null,
    suspendedReason: null,
    decommissionedAt: null,
    dataRetentionUntil: null,
    legalHold: false,
  } as Omit<TenantEntity, 'createdAt' | 'updatedAt'>;
}

function config(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60_000, maxRequests: 1000 },
    cors: { origins: ['http://localhost:3002'], methods: ['GET', 'POST'], credentials: true },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'apply.example.edu', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  };
}

describe('PRC-H113 portal-originated public registration calls through the gateway', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env['DATABASE_URL'];
    seeded.tenants = { a: TENANT_A, b: TENANT_B };
    seeded.schools = { a: SCHOOL_A, b: SCHOOL_B };
    const tenants = new InMemoryTenantRepository();
    await tenants.createTenant(tenant(TENANT_A, 'district-a'));
    await tenants.createTenant(tenant(TENANT_B, 'district-b'));
    await tenants.addDomain({
      id: randomUUID(),
      tenantId: TENANT_B,
      domain: 'admissions.district-b.example',
      primary: true,
      verified: true,
      createdAt: new Date(),
    });
    const { buildApp } = await import('./app.js');
    app = await buildApp({
      config: config(),
      publicTenantResolver: createPublicTenantResolver({
        repository: tenants,
        baseDomain: 'apply.example.edu',
      }),
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  /** What the portal transport sends: the applicant's public host as Host, from the portal. */
  const portalCall = (publicHost: string, extra: Record<string, string> = {}) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/registrations/institutions',
      headers: { host: publicHost, ...extra },
    });

  const names = (body: unknown) =>
    ((body as { data?: Array<{ name: string }> }).data ?? []).map((row) => row.name);

  it('two tenant hostnames return different institution lists', async () => {
    const a = await portalCall('district-a.apply.example.edu');
    expect(a.statusCode, a.body).toBe(200);
    expect(names(a.json())).toEqual(['Alpha School']);
    const b = await portalCall('admissions.district-b.example');
    expect(b.statusCode, b.body).toBe(200);
    expect(names(b.json())).toEqual(['Beta School']);
  });

  it('forwarding and tenant headers sent to the gateway cannot re-target another tenant', async () => {
    const response = await portalCall('district-a.apply.example.edu', {
      'x-forwarded-host': 'admissions.district-b.example',
      'x-tenant-id': TENANT_B,
    });
    expect(response.statusCode).toBe(200);
    expect(names(response.json())).toEqual(['Alpha School']);
  });

  it('the internal gateway hostname (portal forgot to forward Host) is not-found, never a default tenant', async () => {
    for (const host of ['api-gateway:3000', 'unknown.apply.example.edu']) {
      const response = await portalCall(host, {
        'x-forwarded-host': 'district-a.apply.example.edu',
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'PUBLIC_REGISTRATION_CONTEXT_NOT_FOUND' });
    }
  });
});
