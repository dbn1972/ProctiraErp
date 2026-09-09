/**
 * Fastify Examination Plugin
 *
 * Registers examination routes and service on a Fastify instance.
 * Provides the examination service as a decorator for other plugins to use.
 *
 * Requirements:
 * - 10.1: Examination CRUD with subjects, centers, sessions, scheduling
 * - 10.4: Result publication with grade calculation within 30 seconds
 * - 10.5: Handle incomplete result data gracefully
 * - 10.6: Generate examination documents as PDF within 60 seconds per batch of 500
 * - 10.7: 1–10 grading schemes per examination with pass thresholds
 * - 10.8: Result analysis with breakdowns by subject, center, gender, area
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { DocumentTaskQueue } from './document-generation-service.js';
import { DocumentGenerationService } from './document-generation-service.js';
import type { DocumentRepository } from './document-repository.js';
import { registerDocumentRoutes } from './document-routes.js';
import type { ExaminationRepository } from './examination-repository.js';
import { ExaminationService } from './examination-service.js';
import type { PdfGenerator } from './pdf-generator.js';
import { ResultPublicationService } from './result-publication-service.js';
import type { ResultRepository } from './result-repository.js';
import { registerResultRoutes } from './result-routes.js';
import { registerExaminationRoutes } from './routes.js';

/**
 * Options for the examination plugin.
 */
export interface ExaminationPluginOptions {
  /** Examination repository implementation */
  repository: ExaminationRepository;
  /** Result repository implementation (optional — required for result publication features) */
  resultRepository?: ResultRepository;
  /** Document repository implementation (optional — required for document generation features) */
  documentRepository?: DocumentRepository;
  /** PDF generator implementation (optional — required for document generation features) */
  pdfGenerator?: PdfGenerator;
  /** Document task queue implementation (optional — for RabbitMQ background processing) */
  documentTaskQueue?: DocumentTaskQueue;
  /** Route prefix for examinations (default: '/examinations') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    examinationService: ExaminationService;
    resultPublicationService?: ResultPublicationService;
    documentGenerationService?: DocumentGenerationService;
  }
}

/**
 * Fastify plugin that registers the examination service and routes.
 */
export const examinationPlugin = fp(
  async function examinationPluginImpl(
    fastify: FastifyInstance,
    options: ExaminationPluginOptions,
  ) {
    const {
      repository,
      resultRepository,
      documentRepository,
      pdfGenerator,
      documentTaskQueue,
      prefix = '/examinations',
    } = options;

    // Create examination service instance
    const examinationService = new ExaminationService(repository);

    // Decorate fastify with the examination service
    fastify.decorate('examinationService', examinationService);

    // Register examination routes
    await registerExaminationRoutes(fastify, {
      examinationService,
      prefix,
    });

    // Register result publication service and routes if result repository is provided
    if (resultRepository) {
      const resultPublicationService = new ResultPublicationService(repository, resultRepository);
      fastify.decorate('resultPublicationService', resultPublicationService);

      await registerResultRoutes(fastify, {
        resultPublicationService,
        prefix,
      });
    }

    // Register document generation service and routes if document repository and PDF generator are provided
    if (documentRepository && pdfGenerator) {
      const documentGenerationService = new DocumentGenerationService(
        repository,
        documentRepository,
        pdfGenerator,
        documentTaskQueue,
      );
      fastify.decorate('documentGenerationService', documentGenerationService);

      await registerDocumentRoutes(fastify, {
        documentGenerationService,
        prefix,
      });
    }
  },
  {
    name: '@proctira/backend-examination',
    fastify: '5.x',
    dependencies: [],
  },
);
