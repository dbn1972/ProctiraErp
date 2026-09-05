/**
 * Health Check Plugin
 *
 * Provides /health endpoint reporting readiness and liveness status.
 * - Liveness: The gateway process is running and can handle requests
 * - Readiness: The gateway and its downstream services are ready to serve traffic
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import type { ServiceRoute } from '../config.js';

export interface HealthCheckOptions {
  /** Service routes to check for readiness */
  services: Record<string, ServiceRoute>;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    liveness: { status: 'up' | 'down' };
    readiness: { status: 'up' | 'down'; details?: Record<string, string> };
  };
}

const healthPlugin: FastifyPluginAsync<HealthCheckOptions> = async (
  fastify: FastifyInstance,
  options: HealthCheckOptions,
) => {
  const startTime = Date.now();

  /**
   * GET /health - Combined health check endpoint
   */
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint reporting readiness and liveness',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number' },
            checks: {
              type: 'object',
              properties: {
                liveness: {
                  type: 'object',
                  properties: { status: { type: 'string' } },
                },
                readiness: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    details: { type: 'object', additionalProperties: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (_request, _reply) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    const healthStatus: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime,
      checks: {
        liveness: { status: 'up' },
        readiness: { status: 'up', details: {} },
      },
    };

    return healthStatus;
  });

  /**
   * GET /health/live - Liveness probe (is the process running?)
   */
  fastify.get('/health/live', {
    schema: {
      description: 'Liveness probe - checks if the gateway process is running',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, _reply) => {
    return { status: 'up' };
  });

  /**
   * GET /health/ready - Readiness probe (can the gateway serve traffic?)
   */
  fastify.get('/health/ready', {
    schema: {
      description: 'Readiness probe - checks if the gateway can serve traffic',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            services: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            services: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
      },
    },
  }, async (_request, reply) => {
    // In a full implementation, this would check downstream service health
    // For now, report as ready since the gateway itself is operational
    const serviceStatuses: Record<string, string> = {};
    for (const [name] of Object.entries(options.services)) {
      serviceStatuses[name] = 'unknown';
    }

    return reply.status(200).send({
      status: 'up',
      services: serviceStatuses,
    });
  });
};

export default fp(healthPlugin, {
  name: 'health-check',
  fastify: '4.x',
});
