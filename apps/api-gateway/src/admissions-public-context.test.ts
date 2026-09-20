import { randomUUID } from 'node:crypto';

import {
  createPublicTenantResolver,
  InMemoryTenantRepository,
  type TenantEntity,
} from '@proctira/backend-tenant';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env.DATABASE_URL;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

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
    cors: {
      origins: ['http://localhost:3002'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
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

describe('gateway public admissions context composition', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const repository = new InMemoryTenantRepository();
    await repository.createTenant(tenant(TENANT_A, 'district-a'));
    await repository.createTenant(tenant(TENANT_B, 'district-b'));
    await repository.addDomain({
      id: randomUUID(),
      tenantId: TENANT_A,
      domain: 'admissions.district-a.example',
      primary: true,
      verified: true,
      createdAt: new Date(),
    });
    app = await buildApp({
      config: config(),
      publicTenantResolver: createPublicTenantResolver({
        repository,
        baseDomain: 'apply.example.edu',
      }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['district-a.apply.example.edu', 'admissions.district-a.example'])(
    'allows a canonical or verified public host without a JWT: %s',
    async (host) => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/registrations/language',
        headers: { host, 'x-tenant-id': TENANT_B },
      });
      expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
      expect(response.json().language).toBe('en');
    },
  );

  it('denies unknown public Host without disclosing whether a tenant exists', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/registrations/language',
      headers: { host: 'unknown.apply.example.edu', 'x-tenant-id': TENANT_A },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      code: 'PUBLIC_REGISTRATION_CONTEXT_NOT_FOUND',
      message: 'Registration portal is unavailable for this request',
    });
  });

  it('does not make staff registration routes public', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/registrations/applications',
      headers: { host: 'district-a.apply.example.edu' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHORIZED');
  });
});
