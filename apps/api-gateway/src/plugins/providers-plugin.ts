import { issueSandboxIdpToken, listProviderCapabilities } from '@proctira/backend-providers';
import { resolveProviderDeliveryMode } from '@proctira/common';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * G-7 / G-10 adjacent — provider capability discovery + sandbox IdP mint.
 * W1-ARCH-08: top-level mode uses fail-closed production policy.
 */
export const providersPlugin = fp(async (app: FastifyInstance) => {
  app.get('/providers/capabilities', async () => ({
    mode: resolveProviderDeliveryMode('providers', process.env),
    capabilities: listProviderCapabilities(process.env),
  }));

  app.post<{
    Body: { subject?: string; tenantId?: string; roles?: string[] };
  }>('/providers/idp/sandbox/token', async (request, reply) => {
    const subject = request.body?.subject;
    const tenantId = request.body?.tenantId;
    if (!subject || !tenantId) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'subject and tenantId are required',
      });
    }
    return issueSandboxIdpToken({
      subject,
      tenantId,
      roles: request.body?.roles,
    });
  });
});
