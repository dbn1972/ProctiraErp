import type { FastifyInstance, FastifyReply } from 'fastify';

import type { LifecycleCertificateService } from './lifecycle-certificate-service.js';
import type { LifecycleCertificateType } from './types.js';

export interface LifecycleCertificateRouteOptions {
  service: LifecycleCertificateService;
  prefix?: string;
}

function actorId(request: { user?: { sub?: string; id?: string } }): string {
  return request.user?.sub ?? request.user?.id ?? 'system';
}

/**
 * SEC-2: `x-tenant-id` is a client-supplied header and must never be trusted as
 * a tenant source for gateway-mounted traffic — the gateway's tenantPlugin
 * already resolves `request.tenantId` from the verified JWT before any domain
 * plugin (including this one) runs (see packages/shared/tenant/src/fastify-plugin.ts
 * and apps/api-gateway/src/app.ts's onRequest hook ordering).
 *
 * Unlike curriculum/gradebook/timetable, this package also boots as a fully
 * standalone service (src/standalone-server.ts) with NO auth or tenant
 * middleware of its own. In that mode `request.tenantId`/`request.user` are
 * never set by anything, so removing the header fallback outright would make
 * certificate routes permanently unresolvable there. Instead, the fallback is
 * gated behind an explicit, default-OFF opt-in flag: TRUST_X_TENANT_ID_HEADER.
 *
 * This flag must NEVER be set to '1' in the gateway-mounted deployment path
 * (it is intentionally not set in standalone-server.ts either — see that
 * file's history for why fail-closed was chosen over trusting the header even
 * there). Only a deployment that has no other way to authenticate the caller
 * and has independently decided to trust its network perimeter should set it.
 */
function isHeaderTenantTrustEnabled(): boolean {
  return process.env['TRUST_X_TENANT_ID_HEADER'] === '1';
}

function tenantId(request: {
  tenantId?: string;
  user?: { tenantId?: string };
  headers: Record<string, unknown>;
}): string | null {
  if (request.user?.tenantId) return request.user.tenantId;
  if (request.tenantId) return request.tenantId;
  if (isHeaderTenantTrustEnabled()) {
    const header = request.headers['x-tenant-id'];
    if (typeof header === 'string' && header.length > 0) return header;
  }
  return null;
}

function requireTenantId(
  request: { tenantId?: string; user?: { tenantId?: string }; headers: Record<string, unknown> },
  reply: FastifyReply,
): string | undefined {
  const tid = tenantId(request);
  if (!tid) {
    void reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Tenant context required',
      statusCode: 401,
    });
    return undefined;
  }
  return tid;
}

export async function registerLifecycleCertificateRoutes(
  fastify: FastifyInstance,
  options: LifecycleCertificateRouteOptions,
): Promise<void> {
  const prefix = options.prefix ?? '/students';
  const { service } = options;

  fastify.post<{
    Params: { studentId: string };
    Body: { type: LifecycleCertificateType; academicYear?: string; remarks?: string };
  }>(`${prefix}/:studentId/certificates`, async (request, reply) => {
    const tid = requireTenantId(request as never, reply);
    if (!tid) return;
    const cert = await service.issue(tid, actorId(request as never), {
      studentId: request.params.studentId,
      type: request.body.type,
      academicYear: request.body.academicYear,
      remarks: request.body.remarks,
    });
    return reply.code(201).send(cert);
  });

  fastify.get<{ Params: { studentId: string } }>(
    `${prefix}/:studentId/certificates`,
    async (request, reply) => {
      const tid = requireTenantId(request as never, reply);
      if (!tid) return;
      const list = await service.listForStudent(tid, request.params.studentId);
      return reply.send({ data: list });
    },
  );

  fastify.get<{ Params: { id: string } }>(`${prefix}/certificates/:id`, async (request, reply) => {
    const tid = requireTenantId(request as never, reply);
    if (!tid) return;
    const cert = await service.get(tid, request.params.id);
    return reply.send(cert);
  });

  fastify.get<{ Querystring: { serial: string } }>(
    `${prefix}/certificates/verify`,
    async (request, reply) => {
      const tid = requireTenantId(request as never, reply);
      if (!tid) return;
      const result = await service.verify(tid, request.query.serial ?? '');
      return reply.send(result);
    },
  );

  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    `${prefix}/certificates/:id/revoke`,
    async (request, reply) => {
      const tid = requireTenantId(request as never, reply);
      if (!tid) return;
      const cert = await service.revoke(tid, request.params.id, request.body?.reason ?? 'revoked');
      return reply.send(cert);
    },
  );
}
