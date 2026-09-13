import type { FastifyInstance } from 'fastify';

import { LifecycleCertificateService } from './lifecycle-certificate-service.js';
import type { LifecycleCertificateType } from './types.js';

export interface LifecycleCertificateRouteOptions {
  service: LifecycleCertificateService;
  prefix?: string;
}

function actorId(request: { user?: { sub?: string; id?: string } }): string {
  return request.user?.sub ?? request.user?.id ?? 'system';
}

function tenantId(request: { tenantId?: string; headers: Record<string, unknown> }): string {
  const header = request.headers['x-tenant-id'];
  return request.tenantId ?? (typeof header === 'string' ? header : '') ?? '';
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
    const tid = tenantId(request as never);
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
      const tid = tenantId(request as never);
      const list = await service.listForStudent(tid, request.params.studentId);
      return reply.send({ data: list });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    `${prefix}/certificates/:id`,
    async (request, reply) => {
      const tid = tenantId(request as never);
      const cert = await service.get(tid, request.params.id);
      return reply.send(cert);
    },
  );

  fastify.get<{ Querystring: { serial: string } }>(
    `${prefix}/certificates/verify`,
    async (request, reply) => {
      const tid = tenantId(request as never);
      const result = await service.verify(tid, request.query.serial ?? '');
      return reply.send(result);
    },
  );

  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    `${prefix}/certificates/:id/revoke`,
    async (request, reply) => {
      const tid = tenantId(request as never);
      const cert = await service.revoke(tid, request.params.id, request.body?.reason ?? 'revoked');
      return reply.send(cert);
    },
  );
}
