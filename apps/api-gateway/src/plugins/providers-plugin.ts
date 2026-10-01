import { DEFAULT_ROLES } from '@proctira/backend-auth';
import { issueSandboxIdpToken, listProviderCapabilities } from '@proctira/backend-providers';
import { resolveProviderDeliveryMode } from '@proctira/common';
import type { FastifyInstance } from 'fastify';

/**
 * G-7 / G-10 adjacent — provider capability discovery + sandbox IdP mint.
 * W1-ARCH-08: top-level mode uses fail-closed production policy.
 */
export interface ProvidersPluginOptions {
  /**
   * PRC-L206: register the sandbox IdP mint route (unsigned `alg: none` test tokens).
   * Defaults to {@link sandboxIdpEnabled} for the process env.
   */
  sandboxIdp?: boolean;
}

/**
 * PRC-L206: the sandbox IdP route exists only outside production, or when an operator sets
 * the explicit `ALLOW_SANDBOX_IDP=1` flag. Its tokens are never accepted by the gateway.
 */
export function sandboxIdpEnabled(
  env: NodeJS.ProcessEnv = process.env,
  gatewayEnv: string | undefined = undefined,
): boolean {
  if (env['ALLOW_SANDBOX_IDP'] === '1') return true;
  return env['NODE_ENV'] !== 'production' && gatewayEnv !== 'production';
}

const SANDBOX_ROLE_IDS = new Set(DEFAULT_ROLES.map((role) => role.roleId));

/**
 * Encapsulated (not fastify-plugin wrapped) so the `/api/v1` register prefix applies. With
 * `fp`, the prefix was ignored and these routes were served at `/providers/*` — outside the
 * gateway's `/api/v1` RBAC hook (PRC-L206).
 */
export async function providersPlugin(app: FastifyInstance, options: ProvidersPluginOptions) {
  app.get('/providers/capabilities', async () => ({
    mode: resolveProviderDeliveryMode('providers', process.env),
    capabilities: listProviderCapabilities(process.env),
  }));
  if (!(options.sandboxIdp ?? sandboxIdpEnabled())) return;
  if (process.env['NODE_ENV'] === 'production') {
    app.log.warn('ALLOW_SANDBOX_IDP=1: sandbox IdP token route is mounted in production');
  }

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
    const roles = request.body?.roles;
    if (roles !== undefined) {
      const unknown = Array.isArray(roles)
        ? roles.filter((role) => typeof role !== 'string' || !SANDBOX_ROLE_IDS.has(role))
        : [roles];
      if (unknown.length > 0) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'roles must be role ids from the role catalogue',
        });
      }
    }
    return issueSandboxIdpToken({
      subject,
      tenantId,
      roles,
    });
  });
}
