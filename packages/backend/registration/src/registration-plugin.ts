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
import { createAdmissionsPipelineStore } from './create-registration-repository.js';
import {
  AdmissionsPipelineService,
  type AssertOfferFeePaid,
  type CreateOfferFeeInvoice,
  type EnrolOnAccept,
  type ReconcileOfferResources,
} from './pipeline/pipeline-service.js';
import type { AdmissionsPipelineStore } from './pipeline/pipeline-store.js';
import { registerAdmissionsPipelineRoutes } from './pipeline/routes.js';
import type { RegistrationRepository } from './registration-repository.js';
import { RegistrationService } from './registration-service.js';
import {
  registerRegistrationRoutes,
  type PublicTenantResolver,
  type RegistrationSessionStore,
} from './routes.js';

/**
 * Options for the registration plugin.
 */
export interface RegistrationPluginOptions {
  /** Registration repository implementation */
  repository: RegistrationRepository;
  /**
   * W1-SEC-05: shared registration session store (required in production).
   * Inject Redis/DB-backed implementation for multi-replica TTL sessions.
   */
  sessionStore?: RegistrationSessionStore;
  /** Waitlist / interview CRM store (G-717). Defaults to in-memory. */
  crmStore?: AdmissionsCrmStore;
  /**
   * Enquiry / merit / seat / offer store (G-906).
   * Defaults via {@link createAdmissionsPipelineStore} (PG when `DATABASE_URL` is set;
   * otherwise in-memory subject to the shared fallback policy).
   */
  pipelineStore?: AdmissionsPipelineStore;
  /** Auto-enrol hook used when an offer is accepted (student + enrollment). */
  enrolOnAccept?: EnrolOnAccept;
  /** G-2: create fee invoice when offer has a non-zero fee. */
  createOfferFeeInvoice?: CreateOfferFeeInvoice;
  /** G-2: require paid offer invoice before enrol. */
  assertOfferFeePaid?: AssertOfferFeePaid;
  /** Reconcile provisional student/invoice state when an offer ends without enrollment. */
  reconcileOfferResources?: ReconcileOfferResources;
  /** Route prefix for registration endpoints (default: '/registrations') */
  prefix?: string;
  /** Staff admissions CRM prefix (default: '/admissions') */
  admissionsPrefix?: string;
  /** Trusted hostname resolver for all anonymous registration routes. */
  publicTenantResolver?: PublicTenantResolver;
  /** Explicit non-production/test fallback tenant; refused in production. */
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
      sessionStore,
      crmStore,
      pipelineStore,
      enrolOnAccept,
      createOfferFeeInvoice,
      assertOfferFeePaid,
      reconcileOfferResources,
      prefix = '/registrations',
      admissionsPrefix = '/admissions',
      publicTenantResolver,
      defaultTenantId,
    } = options;

    // Shared CRM so waitlist enqueue (staff) and seat-release promote (pipeline) see one queue.
    const crm = crmStore; // RegistrationService defaults to in-memory when undefined
    const registrationService = new RegistrationService(repository, crm);

    // Decorate fastify with the registration service
    fastify.decorate('registrationService', registrationService);

    // Register public registration routes
    await registerRegistrationRoutes(fastify, {
      registrationService,
      prefix,
      publicTenantResolver,
      defaultTenantId,
      sessionStore,
    });

    const pipelineService = new AdmissionsPipelineService(
      pipelineStore ?? createAdmissionsPipelineStore(),
      repository,
      enrolOnAccept,
      createOfferFeeInvoice,
      assertOfferFeePaid,
      // Prefer the same store RegistrationService uses (including its default in-memory).
      (registrationService as unknown as { crm: AdmissionsCrmStore }).crm,
      reconcileOfferResources,
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
