/**
 * Headless Fastify server used by the E2E suite.
 *
 * It registers the real `@proctira/tenant` plugin so that all JWT-claim,
 * header, and subdomain resolution rules execute end-to-end. Routes return
 * deterministic, tenant-scoped fake data so the suite can prove that no
 * tenant ever observes another tenant's rows over the wire.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */

import Fastify, { type FastifyInstance } from 'fastify';

import { tenantPlugin } from '@proctira/tenant';

interface InstitutionRow {
  id: string;
  tenantId: string;
  name: string;
}

const seededInstitutions = new Map<string, InstitutionRow[]>();

/**
 * Seeds a deterministic data set per tenant. Each tenant gets two rows
 * whose ids embed the tenant id, making leak detection trivial.
 */
function seedInstitutions(tenantId: string): InstitutionRow[] {
  const cached = seededInstitutions.get(tenantId);
  if (cached) return cached;
  const rows: InstitutionRow[] = [
    { id: `${tenantId}:inst-1`, tenantId, name: `${tenantId} High School` },
    { id: `${tenantId}:inst-2`, tenantId, name: `${tenantId} Primary School` },
  ];
  seededInstitutions.set(tenantId, rows);
  return rows;
}

export interface BuildAppOptions {
  /** When true, simulates the auth plugin populating `request.user` from a JWT. */
  jwtTenantId?: string;
}

export async function buildIsolationApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Optional: simulate `@proctira/auth` running before the tenant plugin.
  if (options.jwtTenantId) {
    app.addHook('onRequest', async (request) => {
      (request as unknown as { user: { tenantId: string; sub: string } }).user = {
        tenantId: options.jwtTenantId!,
        sub: 'jwt-user',
      };
    });
  }

  await app.register(tenantPlugin, {
    excludePaths: ['/health'],
    getDbClient: () => ({ $executeRawUnsafe: async () => undefined }),
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/v1/institutions', async (request) => {
    const rows = seededInstitutions.get(request.tenantId!) ?? seedInstitutions(request.tenantId!);
    return { tenantId: request.tenantId, items: rows };
  });

  app.get('/api/v1/institutions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = seededInstitutions.get(request.tenantId!) ?? seedInstitutions(request.tenantId!);
    const row = rows.find((r) => r.id === id);
    if (!row) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Resource not found' });
    }
    return row;
  });

  return app;
}

/**
 * Starts the isolation app on an explicit port (default 4711). Returns the
 * Fastify instance plus the resolved base URL so tests can build absolute
 * request URLs.
 */
export async function startIsolationServer(
  port = Number(process.env['TENANT_E2E_PORT'] ?? 4711),
): Promise<{
  app: FastifyInstance;
  baseUrl: string;
}> {
  const app = await buildIsolationApp();
  await app.listen({ port, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind tenant isolation E2E server');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { app, baseUrl };
}
