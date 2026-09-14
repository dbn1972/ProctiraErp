/**
 * W2-API-02 / W2-API-03: public API contract stability surfaces.
 * - GET /api/v1/meta/error-codes — machine-readable error registry
 * - GET /api/v1/meta/deprecation-policy — sunset / successor conventions
 */
import {
  applyDeprecationHeaders,
  defaultSunsetDate,
  ERROR_CODE_REGISTRY,
} from '@proctira/common';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface ApiContractPluginOptions {
  prefix?: string;
}

export const apiContractPlugin = fp(
  async function apiContractPluginImpl(
    fastify: FastifyInstance,
    options: ApiContractPluginOptions = {},
  ) {
    const prefix = options.prefix ?? '/api/v1/meta';

    fastify.get(`${prefix}/error-codes`, async (_request, reply) => {
      return reply.send({
        version: '1.1.0',
        codes: ERROR_CODE_REGISTRY,
      });
    });

    fastify.get(`${prefix}/deprecation-policy`, async (_request, reply) => {
      return reply.send({
        version: '1.0.0',
        headers: ['Deprecation', 'Sunset', 'Link', 'X-API-Deprecation-Note'],
        defaultSunsetDays: 180,
        exampleSunset: defaultSunsetDate(new Date('2026-01-01T00:00:00.000Z')),
        successorRel: 'successor-version',
        note: 'Deprecated routes must advertise Sunset at least 180 days before removal; after Sunset they return 410 GONE.',
      });
    });

    /**
     * Example deprecated probe — documents header application for clients/tests.
     * Not used by product UI; kept under /meta for contract discovery.
     */
    fastify.get(`${prefix}/deprecated-example`, async (_request, reply) => {
      const policy = {
        deprecation: 'true',
        sunset: defaultSunsetDate(new Date('2026-01-01T00:00:00.000Z')),
        successor: `${prefix}/error-codes`,
        note: 'Example only - migrate to /meta/error-codes',
      };
      applyDeprecationHeaders(
        {
          setHeader: (name, value) => {
            reply.header(name, value);
          },
        },
        policy,
      );
      return { status: 'deprecated', successor: `${prefix}/error-codes` };
    });
  },
  {
    name: 'api-contract-stability',
    fastify: '5.x',
  },
);

export default apiContractPlugin;
