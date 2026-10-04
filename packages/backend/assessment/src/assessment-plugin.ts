/**
 * Fastify Assessment Plugin
 *
 * Registers assessment routes and service on a Fastify instance.
 * Provides the assessment service as a decorator for other plugins to use.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type {
  GradingSchemeRepository,
  AssessmentItemRepository,
  OutcomeRepository,
} from './assessment-repository.js';
import { AssessmentService } from './assessment-service.js';
import {
  createReportCardArtifactStore,
  type ReportCardArtifactStore,
} from './report-card-artifact-store.js';
import { createReportCardDirectory, type ReportCardDirectory } from './report-card-directory.js';
import { ReportCardPdfGenerator } from './report-card-pdf-generator.js';
import type {
  ReportCardTemplateRepository,
  TeacherCommentRepository,
  InstitutionBrandingRepository,
  ReportCardJobRepository,
} from './report-card-repository.js';
import { registerReportCardRoutes } from './report-card-routes.js';
import { ReportCardService } from './report-card-service.js';
import type { TaskQueuePublisher, PdfGenerator } from './report-card-service.js';
import { createReportCardWorker, type ReportCardWorker } from './report-card-worker.js';
import type { AssessmentResultRepository } from './result-repository.js';
import { registerResultRoutes } from './result-routes.js';
import { ResultService } from './result-service.js';
import { registerAssessmentRoutes } from './routes.js';

/**
 * Options for the assessment plugin.
 */
export interface AssessmentPluginOptions {
  /** Grading scheme repository implementation */
  gradingSchemeRepository: GradingSchemeRepository;
  /** Assessment item repository implementation */
  assessmentItemRepository: AssessmentItemRepository;
  /** Outcome repository implementation */
  outcomeRepository: OutcomeRepository;
  /** Assessment result repository implementation */
  resultRepository?: AssessmentResultRepository;
  /** Report card template repository implementation */
  reportCardTemplateRepository?: ReportCardTemplateRepository;
  /** Teacher comment repository implementation */
  teacherCommentRepository?: TeacherCommentRepository;
  /** Institution branding repository implementation */
  institutionBrandingRepository?: InstitutionBrandingRepository;
  /** Report card job repository implementation */
  reportCardJobRepository?: ReportCardJobRepository;
  /** Task queue publisher for background processing (RabbitMQ) */
  taskQueuePublisher?: TaskQueuePublisher;
  /**
   * PRC-H039: queue adapter (dedicated connection) the in-process report-card
   * worker consumes from. Started on onReady, stopped on onClose. When a
   * publisher is configured without a worker queue, jobs are also processed
   * inline so they never stay `queued` with no consumer.
   */
  reportCardWorkerQueue?: QueueAdapter;
  /** PDF generator implementation (defaults to the pdf-lite ReportCardPdfGenerator) */
  pdfGenerator?: PdfGenerator;
  /** Where generated PDFs are kept for download (defaults from env: filesystem) */
  reportCardArtifactStore?: ReportCardArtifactStore;
  /**
   * PRC-H036: student/subject/period name resolver for report cards. Defaults to
   * the Postgres directory when a shared pool exists; `null` disables it (jobs fail).
   */
  reportCardDirectory?: ReportCardDirectory | null;
  /** Route prefix for grading schemes (default: '/grading-schemes') */
  gradingSchemesPrefix?: string;
  /** Route prefix for assessment items (default: '/assessment-items') */
  assessmentItemsPrefix?: string;
  /** Route prefix for outcomes (default: '/outcomes') */
  outcomesPrefix?: string;
  /** Route prefix for results (default: '/results') */
  resultsPrefix?: string;
  /** Route prefix for report cards (default: '/report-cards') */
  reportCardsPrefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    assessmentService: AssessmentService;
    resultService?: ResultService;
    reportCardService?: ReportCardService;
    reportCardWorker?: ReportCardWorker;
  }
}

/**
 * Fastify plugin that registers the assessment service and routes.
 */
export const assessmentPlugin = fp(
  async function assessmentPluginImpl(fastify: FastifyInstance, options: AssessmentPluginOptions) {
    const {
      gradingSchemeRepository,
      assessmentItemRepository,
      outcomeRepository,
      resultRepository,
      reportCardTemplateRepository,
      teacherCommentRepository,
      institutionBrandingRepository,
      reportCardJobRepository,
      taskQueuePublisher,
      reportCardWorkerQueue,
      pdfGenerator,
      reportCardArtifactStore,
      reportCardDirectory,
      gradingSchemesPrefix = '/grading-schemes',
      assessmentItemsPrefix = '/assessment-items',
      outcomesPrefix = '/outcomes',
      resultsPrefix = '/results',
      reportCardsPrefix = '/report-cards',
    } = options;

    // Create assessment service instance
    const assessmentService = new AssessmentService(
      gradingSchemeRepository,
      assessmentItemRepository,
      outcomeRepository,
    );

    // Decorate fastify with the assessment service
    fastify.decorate('assessmentService', assessmentService);

    // Register assessment routes
    await registerAssessmentRoutes(fastify, {
      assessmentService,
      gradingSchemesPrefix,
      assessmentItemsPrefix,
      outcomesPrefix,
    });

    // Register result routes if result repository is provided
    let resultService: ResultService | undefined;
    if (resultRepository) {
      resultService = new ResultService(
        resultRepository,
        assessmentItemRepository,
        gradingSchemeRepository,
      );

      fastify.decorate('resultService', resultService);

      await registerResultRoutes(fastify, {
        resultService,
        resultsPrefix,
      });
    }

    // Register report card routes if all required repositories are provided
    if (
      reportCardTemplateRepository &&
      teacherCommentRepository &&
      institutionBrandingRepository &&
      reportCardJobRepository &&
      resultService
    ) {
      // PRC-H039: only publish when a consumer is registered; otherwise jobs
      // would stay `queued` forever, so fall back to inline processing.
      const effectivePublisher =
        taskQueuePublisher && reportCardWorkerQueue ? taskQueuePublisher : null;
      if (taskQueuePublisher && !reportCardWorkerQueue) {
        fastify.log.warn(
          'report-card queue publisher configured without a consumer; processing inline',
        );
      }
      const reportCardService = new ReportCardService(
        reportCardTemplateRepository,
        teacherCommentRepository,
        institutionBrandingRepository,
        reportCardJobRepository,
        resultService,
        assessmentItemRepository,
        effectivePublisher,
        pdfGenerator ?? new ReportCardPdfGenerator(),
        {
          artifactStore: reportCardArtifactStore ?? createReportCardArtifactStore(),
          resultRepository,
          directory:
            reportCardDirectory === undefined ? createReportCardDirectory() : reportCardDirectory,
          // Without a queue consumer there is no worker, so finish the job in-request.
          processInline: !effectivePublisher,
        },
      );

      fastify.decorate('reportCardService', reportCardService);
      if (effectivePublisher && reportCardWorkerQueue) {
        const worker = createReportCardWorker({
          queue: reportCardWorkerQueue,
          processor: reportCardService,
          logger: {
            info: (obj, msg) => fastify.log.info(obj, msg),
            error: (obj, msg) => fastify.log.error(obj, msg),
          },
        });
        fastify.decorate('reportCardWorker', worker);
        // Consumer binds its work queue before the server accepts traffic, so
        // mandatory dispatch (PRC-H087) always finds a bound queue.
        fastify.addHook('onReady', async () => {
          await worker.start();
        });
        fastify.addHook('onClose', async () => {
          await worker.stop();
        });
      }

      await registerReportCardRoutes(fastify, {
        reportCardService,
        prefix: reportCardsPrefix,
      });
    }
  },
  {
    name: '@proctira/backend-assessment',
    fastify: '5.x',
    dependencies: [],
  },
);
