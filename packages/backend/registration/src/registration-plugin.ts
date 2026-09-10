/**
 * Fastify Registration Plugin
 *
 * Registers public registration routes and service on a Fastify instance.
 * This plugin provides the registration portal backend for public-facing
 * student enrollment applications.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AdmissionsCrmStore } from './admissions-crm-store.js';
import { AdmissionsPipelineService, type EnrolOnAccept } from './pipeline/pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline/pipeline-store.js';
import type { AdmissionsPipelineStore } from './pipeline/pipeline-store.js';
import { registerAdmissionsPipelineRoutes } from './pipeline/routes.js';
import type { RegistrationRepository } from './registration-repository.js';
import { RegistrationService } from './registration-service.js';
import { registerRegistrationRoutes } from './routes.js';

/**
 * Options for the registration plugin.
 */
export interface RegistrationPluginOptions {
  /** Registration repository implementation */
  repository: RegistrationRepository;
  /** Waitlist / interview CRM store (G-717). Defaults to in-memory. */
  crmStore?: AdmissionsCrmStore;
  /** Enquiry / merit / seat / offer store (G-906). Defaults to in-memory. */
  pipelineStore?: AdmissionsPipelineStore;
  /** Auto-enrol hook used when an offer is accepted (student + enrollment). */
  enrolOnAccept?: EnrolOnAccept;
  /** Route prefix for registration endpoints (default: '/registrations') */
  prefix?: string;
  /** Staff admissions CRM prefix (default: '/admissions') */
  admissionsPrefix?: string;
  /** Default tenant ID for public routes */
  defaultTenantId?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    registrationService: RegistrationService;
  }
}

/**
 * Fastify plugin that registers the registration service and public routes.
 *
 * All routes are public (no authentication required) as they serve
 * the public registration portal for parents/students.
 */
export const registrationPlugin = fp(
  async function registrationPluginImpl(
    fastify: FastifyInstance,
    options: RegistrationPluginOptions,
  ) {
    const {
      repository,
      crmStore,
      pipelineStore,
      enrolOnAccept,
      prefix = '/registrations',
      admissionsPrefix = '/admissions',
      defaultTenantId,
    } = options;

    // Create registration service instance
    const registrationService = new RegistrationService(repository, crmStore);

    // Decorate fastify with the registration service
    fastify.decorate('registrationService', registrationService);

    // Register public registration routes
    await registerRegistrationRoutes(fastify, {
      registrationService,
      prefix,
      defaultTenantId,
    });

    const pipelineService = new AdmissionsPipelineService(
      pipelineStore ?? new InMemoryAdmissionsPipelineStore(),
      repository,
      enrolOnAccept,
    );
    await registerAdmissionsPipelineRoutes(fastify, {
      service: pipelineService,
      prefix: admissionsPrefix,
    });
  },
  {
    name: '@proctira/backend-registration',
    fastify: '5.x',
    dependencies: [],
  },
);
