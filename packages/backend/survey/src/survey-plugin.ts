/**
 * Fastify Survey Plugin
 *
 * Registers survey routes and service on a Fastify instance.
 * Provides the survey service as a decorator for other plugins to use.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type {
  SurveyRepository,
  DistributionRepository,
  SubmissionRepository,
  InstitutionLookup,
} from './survey-repository.js';
import { SurveyService } from './survey-service.js';
import type { NotificationPublisher } from './survey-service.js';
import { registerSurveyRoutes } from './routes.js';

/**
 * Options for the survey plugin.
 */
export interface SurveyPluginOptions {
  /** Survey repository implementation */
  surveyRepository: SurveyRepository;
  /** Distribution repository implementation */
  distributionRepository: DistributionRepository;
  /** Submission repository implementation */
  submissionRepository: SubmissionRepository;
  /** Institution lookup implementation */
  institutionLookup: InstitutionLookup;
  /** Notification publisher for reminders (optional) */
  notificationPublisher?: NotificationPublisher;
  /** Route prefix for surveys (default: '/surveys') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    surveyService: SurveyService;
  }
}

/**
 * Fastify plugin that registers the survey service and routes.
 */
export const surveyPlugin = fp(
  async function surveyPluginImpl(
    fastify: FastifyInstance,
    options: SurveyPluginOptions,
  ) {
    const {
      surveyRepository,
      distributionRepository,
      submissionRepository,
      institutionLookup,
      notificationPublisher,
      prefix = '/surveys',
    } = options;

    // Create survey service instance
    const surveyService = new SurveyService(
      surveyRepository,
      distributionRepository,
      submissionRepository,
      institutionLookup,
      notificationPublisher ?? null,
    );

    // Decorate fastify with the survey service
    fastify.decorate('surveyService', surveyService);

    // Register survey routes
    await registerSurveyRoutes(fastify, {
      surveyService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-survey',
    fastify: '4.x',
    dependencies: [],
  },
);
