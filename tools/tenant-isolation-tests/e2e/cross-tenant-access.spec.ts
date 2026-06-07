/**
 * Category 3 — E2E: cross-tenant access prevention.
 *
 * Drives HTTP traffic against the headless Fastify app booted in
 * `global-setup.ts`. The app registers the real `@proctira/tenant` plugin
 * so the JWT-claim → header → subdomain priority chain executes for real.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7 (tenant isolation), 23.6 (header spoofing prevention)
 */

import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const baseURL = process.env['TENANT_E2E_BASE_URL'] ?? 'http://127.0.0.1:4711';

function newTenantId(): string {
  return randomUUID();
}

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await pwRequest.newContext({ baseURL });
});

test.afterAll(async () => {
  await api.dispose();
});

test('health endpoint is reachable without a tenant header', async () => {
  const response = await api.get('/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ status: 'ok' });
});

test('request without tenant identifier is rejected with 401', async () => {
  const response = await api.get('/api/v1/institutions');
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.code).toBe('TENANT_RESOLUTION_FAILED');
});

test('two tenants get fully disjoint result sets for the same endpoint', async () => {
  const tenantA = newTenantId();
  const tenantB = newTenantId();

  const respA = await api.get('/api/v1/institutions', {
    headers: { 'x-tenant-id': tenantA },
  });
  const respB = await api.get('/api/v1/institutions', {
    headers: { 'x-tenant-id': tenantB },
  });

  expect(respA.status()).toBe(200);
  expect(respB.status()).toBe(200);

  const bodyA = await respA.json();
  const bodyB = await respB.json();

  expect(bodyA.tenantId).toBe(tenantA);
  expect(bodyB.tenantId).toBe(tenantB);

  for (const item of bodyA.items) {
    expect(item.tenantId).toBe(tenantA);
    expect(item.id.includes(tenantB)).toBe(false);
  }
  for (const item of bodyB.items) {
    expect(item.tenantId).toBe(tenantB);
    expect(item.id.includes(tenantA)).toBe(false);
  }
});

test('tenant A cannot fetch a tenant B resource by id', async () => {
  const tenantA = newTenantId();
  const tenantB = newTenantId();

  // Tenant B fetches its own list to learn a real id.
  const listB = await api.get('/api/v1/institutions', {
    headers: { 'x-tenant-id': tenantB },
  });
  const bodyB = await listB.json();
  const targetId = bodyB.items[0].id as string;
  expect(targetId.startsWith(tenantB)).toBe(true);

  // Tenant A tries to fetch tenant B's resource. Must 404 (not 200).
  const cross = await api.get(`/api/v1/institutions/${encodeURIComponent(targetId)}`, {
    headers: { 'x-tenant-id': tenantA },
  });
  expect(cross.status()).toBe(404);
});

test('rejects an invalid (non-UUID) tenant id even when sent in the header', async () => {
  const response = await api.get('/api/v1/institutions', {
    headers: { 'x-tenant-id': 'not-a-uuid' },
  });
  expect(response.status()).toBe(401);
  const body = await response.json();
  expect(body.code).toBe('TENANT_RESOLUTION_FAILED');
});

test('repeated requests for the same tenant never expose another tenant`s rows', async () => {
  // Use a small set of tenants and run many interleaved requests so any race
  // or shared-state bug in the plugin would surface.
  const tenants = Array.from({ length: 5 }, () => newTenantId());
  const requests: Promise<void>[] = [];

  for (let i = 0; i < 30; i += 1) {
    const tenantId = tenants[i % tenants.length]!;
    requests.push(
      api
        .get('/api/v1/institutions', { headers: { 'x-tenant-id': tenantId } })
        .then(async (response) => {
          expect(response.status()).toBe(200);
          const body = await response.json();
          expect(body.tenantId).toBe(tenantId);
          for (const item of body.items) {
            expect(item.tenantId).toBe(tenantId);
            for (const other of tenants) {
              if (other === tenantId) continue;
              expect(item.id.includes(other)).toBe(false);
              expect(item.name.includes(other)).toBe(false);
            }
          }
        }),
    );
  }
  await Promise.all(requests);
});
