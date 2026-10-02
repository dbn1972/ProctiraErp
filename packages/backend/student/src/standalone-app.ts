/**
 * PRC-L502 — testable builder for the standalone student service.
 *
 * - Every domain route requires a verified gateway JWT (401 otherwise).
 * - GET /ready probes the database and returns 503 when it is down.
 * - In production the destructive-delete legal-hold guard is mandatory
 *   (StudentService refuses to construct without it), so the standalone
 *   service fails closed there instead of deleting without a legal-hold check.
 */
import { runReadinessProbe, type ReadinessProbeOptions } from '@proctira/database';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerStandaloneAuth, type StandaloneJwtOptions } from './standalone-auth.js';
import { studentPlugin } from './student-plugin.js';
import type { StudentRepository } from './student-repository.js';

export const STANDALONE_SERVICE_NAME = 'student';

export interface StandaloneAppOptions {
  repository: StudentRepository;
  jwt: StandaloneJwtOptions;
  /** Readiness probe overrides (tests inject a failing DB probe). */
  readiness?: ReadinessProbeOptions;
  logger?: FastifyServerOptions['logger'];
  /** Extra registration before the domain plugin (e.g. observability). */
  beforeDomain?: (app: FastifyInstance) => Promise<void>;
}

export async function buildStandaloneStudentApp(
  options: StandaloneAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  registerStandaloneAuth(app, options.jwt);
  if (options.beforeDomain) await options.beforeDomain(app);

  app.get('/health', async (_request, reply) =>
    reply.status(200).send({
      status: 'healthy',
      service: STANDALONE_SERVICE_NAME,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env['npm_package_version'] || '0.1.0',
    }),
  );

  app.get('/ready', async (_request, reply) => {
    const probe = await runReadinessProbe(options.readiness);
    return reply.status(probe.ready ? 200 : 503).send({
      status: probe.ready ? 'ready' : 'not_ready',
      service: STANDALONE_SERVICE_NAME,
      dependencies: probe.dependencies,
      timestamp: new Date().toISOString(),
    });
  });

  await app.register(studentPlugin, { prefix: '/students', repository: options.repository });
  return app;
}
