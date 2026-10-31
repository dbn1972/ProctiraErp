/**
 * Fastify plugin for the LMS domain (assignments · homework · quizzes · Spiral PAL).
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { prepareLmsFileSigningAtStartup } from './lms-file-store.js';
import type { LmsRepository } from './lms-repository.js';
import { LmsService, type LmsAuditSink } from './lms-service.js';
import { registerLmsRoutes } from './routes.js';

export interface LmsPluginOptions {
  repository: LmsRepository;
  /** Route prefix (default: '/lms') */
  prefix?: string;
  /** PRC-L320: pre-built service shared with in-process callers (rollover). */
  service?: LmsService;
  /** PRC-M527: domain audit sink, used when the plugin builds its own service. */
  auditSink?: LmsAuditSink | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    lmsService: LmsService;
  }
}

export const lmsPlugin = fp(
  async function lmsPluginImpl(fastify: FastifyInstance, options: LmsPluginOptions) {
    prepareLmsFileSigningAtStartup(process.env, {
      warn: (obj, msg) => {
        fastify.log.warn(obj, msg);
      },
      error: (obj, msg) => {
        fastify.log.error(obj, msg);
      },
    });
    const { repository, prefix = '/lms' } = options;
    const lmsService =
      options.service ?? new LmsService(repository, { auditSink: options.auditSink ?? null });
    fastify.decorate('lmsService', lmsService);
    await registerLmsRoutes(fastify, { lmsService, prefix });
  },
  {
    name: '@proctira/backend-lms',
    fastify: '5.x',
    dependencies: [],
  },
);

export default lmsPlugin;
