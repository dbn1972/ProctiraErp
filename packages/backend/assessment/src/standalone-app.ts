/**
 * PRC-M167 — testable builder for the standalone assessment service.
 *
 * - Every domain route requires a verified gateway JWT (401 otherwise); tenant
 *   comes only from the verified token.
 * - Repositories come from the same factories the gateway uses, so DATABASE_URL
 *   selects Postgres (one shared PrismaClient + shared pg pool) and the shared
 *   in-memory fallback policy applies otherwise.
 * - GET /ready probes the database and returns 503 when it is down.
 */
import { runReadinessProbe, type ReadinessProbeOptions } from '@proctira/database';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { assessmentPlugin, type AssessmentPluginOptions } from './assessment-plugin.js';
import {
  createAssessmentItemRepository,
  createAssessmentResultRepository,
  createGradingSchemeRepository,
  createInstitutionBrandingRepository,
  createOutcomeRepository,
  createReportCardJobRepository,
  createReportCardTemplateRepository,
  createTeacherCommentRepository,
  type AssessmentRepositoryConfig,
} from './repository-factory.js';
import { registerStandaloneAuth, type StandaloneJwtOptions } from './standalone-auth.js';

export const STANDALONE_SERVICE_NAME = 'assessment';

type RepositoryOptions = Pick<
  AssessmentPluginOptions,
  | 'gradingSchemeRepository'
  | 'assessmentItemRepository'
  | 'outcomeRepository'
  | 'resultRepository'
  | 'reportCardTemplateRepository'
  | 'teacherCommentRepository'
  | 'institutionBrandingRepository'
  | 'reportCardJobRepository'
>;

export interface StandaloneAssessmentAppOptions {
  jwt: StandaloneJwtOptions;
  /** Repository overrides (tests); defaults to the gateway factories. */
  repositories?: Partial<RepositoryOptions>;
  /** Passed to the factories (defaults to process.env.DATABASE_URL). */
  repositoryConfig?: AssessmentRepositoryConfig;
  /** Extra plugin options (e.g. reportCardDirectory for tests). */
  pluginOptions?: Partial<AssessmentPluginOptions>;
  readiness?: ReadinessProbeOptions;
  logger?: FastifyServerOptions['logger'];
  /** Extra registration before the domain plugin (e.g. observability). */
  beforeDomain?: (app: FastifyInstance) => Promise<void>;
}

/**
 * Repositories built from the shared factories (one Prisma client per URL);
 * an override replaces the factory for that repository only.
 */
export function createStandaloneRepositories(
  config: AssessmentRepositoryConfig = {},
  overrides: Partial<RepositoryOptions> = {},
): RepositoryOptions {
  return {
    gradingSchemeRepository:
      overrides.gradingSchemeRepository ?? createGradingSchemeRepository(config),
    assessmentItemRepository:
      overrides.assessmentItemRepository ?? createAssessmentItemRepository(config),
    outcomeRepository: overrides.outcomeRepository ?? createOutcomeRepository(config),
    resultRepository: overrides.resultRepository ?? createAssessmentResultRepository(config),
    reportCardTemplateRepository:
      overrides.reportCardTemplateRepository ?? createReportCardTemplateRepository(config),
    teacherCommentRepository:
      overrides.teacherCommentRepository ?? createTeacherCommentRepository(config),
    institutionBrandingRepository:
      overrides.institutionBrandingRepository ?? createInstitutionBrandingRepository(config),
    reportCardJobRepository:
      overrides.reportCardJobRepository ?? createReportCardJobRepository(config),
  };
}

export async function buildStandaloneAssessmentApp(
  options: StandaloneAssessmentAppOptions,
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
  // assessmentPlugin is fastify-plugin wrapped (no encapsulation), so mount it in
  // a child context: the prefix applies and its RBAC preHandlers cannot reach
  // /health, /ready or /metrics.
  await app.register(
    async (child) => {
      await child.register(assessmentPlugin, { ...options.pluginOptions, ...repositories });
    },
    { prefix: '/assessments' },
  );
  return app;
}
