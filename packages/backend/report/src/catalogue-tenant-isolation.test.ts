/**
 * PRC-L339 (topic 4 — tenant isolation): the report catalogue must take the
 * caller tenant ONLY from the verified principal, never from a client-supplied
 * `x-tenant-id` header. A principal verified for tenant B that spoofs
 * `x-tenant-id: <A>` must act only on tenant B and must never read tenant A's
 * artifacts.
 *
 * Failing-first: on base, `resolveTenantId` trusts the header before the
 * principal, so the spoofed header leaks tenant A's artifact to a tenant-B
 * caller. With the fix the header is ignored and the read is scoped to B (404).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { InMemoryReportStore } from './report-store.js';

const TENANT_A = '00000000-0000-4000-8000-00000000a0a0';
const TENANT_B = '00000000-0000-4000-8000-00000000b0b0';

interface Shared {
  store: InMemoryReportStore;
  blobs: InMemoryReportBlobStore;
}

const apps: FastifyInstance[] = [];
const savedDemo = process.env.REPORT_DEMO_DATA;

beforeAll(() => {
  // No DB pool in unit tests: providers must be explicitly opted into demo rows (PRC-H080).
  process.env.REPORT_DEMO_DATA = '1';
});

afterAll(() => {
  if (savedDemo === undefined) delete process.env.REPORT_DEMO_DATA;
  else process.env.REPORT_DEMO_DATA = savedDemo;
});

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

function newShared(): Shared {
  return { store: new InMemoryReportStore(), blobs: new InMemoryReportBlobStore() };
}

/** A principal verified for `tenantId`. Any `spoofHeader` is attacker-controlled. */
async function appAs(
  tenantId: string,
  roles: string[],
  sub: string,
  shared: Shared,
): Promise<FastifyInstance> {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    // The verified principal carries the tenant (as it does from a JWT claim).
    // Deliberately NOT decorating request.tenantId here: the catalogue route must
    // still take the tenant from the verified principal and never from a
    // client-supplied x-tenant-id header. On base the header outranks the
    // principal's own tenant, which is the PRC-L339 leak.
    (request as typeof request & { user: unknown }).user = {
      sub,
      tenantId,
      roles: roles.map((r) => ({ roleId: r, roleName: r })),
    };
  });
  await app.register(reportCataloguePlugin, {
    store: shared.store,
    blobStore: shared.blobs,
    disableScheduler: true,
  });
  await app.ready();
  return app;
}

describe('PRC-L339 report catalogue ignores spoofed x-tenant-id', () => {
  it('does not let a tenant-B principal read tenant A artifacts via x-tenant-id: A', async () => {
    const shared = newShared();

    // Tenant A manager generates an artifact.
    const ownerA = await appAs(TENANT_A, ['principal'], 'principal-a', shared);
    const gen = await ownerA.inject({
      method: 'POST',
      url: '/reports/generate',
      headers: { 'x-tenant-id': TENANT_A },
      payload: { reportKey: 'students_roster', format: 'CSV' },
    });
    expect(gen.statusCode).toBe(201);
    const { artifactId } = gen.json() as { artifactId: string };

    // Tenant B manager spoofs x-tenant-id: A to read A's artifact.
    const attackerB = await appAs(TENANT_B, ['principal'], 'principal-b', shared);
    const read = await attackerB.inject({
      method: 'GET',
      url: `/reports/artifacts/${artifactId}`,
      headers: { 'x-tenant-id': TENANT_A },
    });

    // Fixed: header ignored → scoped to B → not found. Base: header honoured → 200 leak.
    expect(read.statusCode).toBe(404);
  });

  it('scopes GET /reports/runs to the verified tenant regardless of x-tenant-id', async () => {
    const shared = newShared();

    const ownerA = await appAs(TENANT_A, ['principal'], 'principal-a', shared);
    const gen = await ownerA.inject({
      method: 'POST',
      url: '/reports/generate',
      headers: { 'x-tenant-id': TENANT_A },
      payload: { reportKey: 'students_roster', format: 'CSV' },
    });
    expect(gen.statusCode).toBe(201);

    const attackerB = await appAs(TENANT_B, ['principal'], 'principal-b', shared);
    const runs = await attackerB.inject({
      method: 'GET',
      url: '/reports/runs',
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(runs.statusCode).toBe(200);
    const body = runs.json() as { data: Array<{ artifactId: string }> };
    // Tenant B has generated nothing; the spoofed header must not surface A's runs.
    expect(body.data).toHaveLength(0);
  });
});
