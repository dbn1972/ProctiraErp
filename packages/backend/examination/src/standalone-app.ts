/**
 * PRC-M621 — testable builder for the standalone examination service.
 *
 * - Every domain route requires a verified gateway JWT (401 otherwise);
 *   tenant comes only from the verified token.
 * - Repositories come from the same factories the gateway uses
 *   (repository-factory.ts), so DATABASE_URL selects Postgres (Prisma + RLS,
 *   one shared pg pool) and the shared in-memory fallback policy applies
 *   otherwise — unlike the previous standalone-server.ts, which always
 *   constructed hard-coded InMemory* repositories regardless of DATABASE_URL.
 * - GET /ready probes the database and returns 503 when it is down.
 */
import { runReadinessProbe, type ReadinessProbeOptions } from '@proctira/database';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { examinationPlugin, type ExaminationPluginOptions } from './examination-plugin.js';
import { SimplePdfGenerator } from './pdf-generator.js';
import { createDocumentBlobStore } from './pg-document-blob-store.js';
import {
  createDocumentRepository,
  createExamOpsStore,
  createExaminationRepository,
  createResultRepository,
  type ExaminationRepositoryConfig,
} from './repository-factory.js';
import { registerStandaloneAuth, type StandaloneJwtOptions } from './standalone-auth.js';

export const STANDALONE_SERVICE_NAME = 'examination';

type RepositoryOptions = Pick<
  ExaminationPluginOptions,
  'repository' | 'resultRepository' | 'documentRepository' | 'examOpsStore' | 'pdfGenerator'
>;

export interface StandaloneExaminationAppOptions {
  jwt: StandaloneJwtOptions;
  /** Repository overrides (tests); defaults to the gateway factories. */
  repositories?: Partial<RepositoryOptions>;
  /** Passed to the factories (defaults to process.env.DATABASE_URL). */
  repositoryConfig?: ExaminationRepositoryConfig;
  /** Extra plugin options (e.g. timeZone, outboxStore). */
  pluginOptions?: Partial<ExaminationPluginOptions>;
  readiness?: ReadinessProbeOptions;
  logger?: FastifyServerOptions['logger'];
  /** Extra registration before the domain plugin (e.g. observability). */
  beforeDomain?: (app: FastifyInstance) => Promise<void>;
}

/**
 * Repositories built from the shared factories (one Prisma client / pg pool
 * per URL, mirroring apps/api-gateway/src/domain-plugins.ts's 'examination'
 * entry); an override replaces the factory for that repository only.
 */
export function createStandaloneRepositories(
  config: ExaminationRepositoryConfig = {},
  overrides: Partial<RepositoryOptions> = {},
): RepositoryOptions {
  const examOpsStore = overrides.examOpsStore ?? createExamOpsStore(config);
  return {
    repository: overrides.repository ?? createExaminationRepository(config),
    resultRepository: overrides.resultRepository ?? createResultRepository(config),
    documentRepository:
      overrides.documentRepository ?? createDocumentRepository(config, examOpsStore),
    examOpsStore,
    // G-902: document routes (/documents/generate, /documents/jobs) only register
    // when a PdfGenerator is supplied, same as the gateway's 'examination' entry.
    pdfGenerator: overrides.pdfGenerator ?? new SimplePdfGenerator(),
  };
}

export async function buildStandaloneExaminationApp(
  options: StandaloneExaminationAppOptions,
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

  const repositories = createStandaloneRepositories(options.repositoryConfig, options.repositories);
  // examinationPlugin is fastify-plugin wrapped (no encapsulation), so mount it in
  // a plain child context: its own '/examinations' route prefix (set below) still
  // applies, but its RBAC preHandlers and `fp` registration cannot leak onto this
  // app's own /health, /ready or /metrics routes (W1-SEC-02).
  await app.register(async (child) => {
    await child.register(examinationPlugin, {
      ...repositories,
      ...options.pluginOptions,
      // PRC-H052: durable blob store when DATABASE_URL is set, so generated
      // PDFs survive a restart instead of a process-local in-memory store.
      documentBlobStore:
        options.pluginOptions?.documentBlobStore ?? createDocumentBlobStore() ?? undefined,
      prefix: '/examinations',
    });
  });
  return app;
}
