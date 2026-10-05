/**
 * Fastify Scholarship Plugin
 *
 * Registers scholarship routes and service on a Fastify instance.
 * Provides the scholarship service as a decorator for other plugins to use.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerApplicationDraftRoutes } from './application-draft-routes.js';
import type { ApplicantAttributesLookup, ApplicantStudentLookup } from './application-intake.js';
import {
  createScholarshipDocumentBlobStore,
  type ScholarshipDocumentBlobStore,
} from './document-blob-store.js';
import type { DownloadTokenReplayStore } from './document-bytes.js';
import { registerScholarshipDocumentRoutes } from './document-routes.js';
import { ScholarshipDocumentService } from './document-service.js';
import {
  InMemoryScholarshipDocumentStore,
  type ScholarshipDocumentStore,
} from './document-store.js';
import { registerScholarshipRoutes } from './routes.js';
import type { ScholarshipRepository } from './scholarship-repository.js';
import { ScholarshipService } from './scholarship-service.js';
import type { WorkflowEngineClient, ScholarshipServiceOptions } from './scholarship-service.js';

/**
 * Options for the scholarship plugin.
 */
export interface ScholarshipPluginOptions {
  /** Scholarship repository implementation */
  repository: ScholarshipRepository;
  /** Workflow engine client for approval routing (optional) */
  workflowEngine?: WorkflowEngineClient;
  /** Service configuration options */
  serviceOptions?: ScholarshipServiceOptions;
  /** Route prefix for scholarships (default: '/scholarships') */
  prefix?: string;
  /** Document metadata. Defaults to an in-memory store (tests / no DATABASE_URL). */
  documentStore?: ScholarshipDocumentStore;
  /** File bytes. Defaults to S3/MinIO when configured, else local disk. */
  documentBlobs?: ScholarshipDocumentBlobStore;
  /** Active guardian → student links for applicant authz. */
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>;
  /** PRC-H030: tenant-scoped student existence check for application subjects. */
  applicantExists?: ApplicantStudentLookup;
  /** PRC-L345: student-record areaId/gender lookup (defaults to Postgres). */
  resolveApplicantAttributes?: ApplicantAttributesLookup;
  /** PRC-L344: shared single-use store for document download links. */
  downloadReplayGuard?: DownloadTokenReplayStore;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    scholarshipService: ScholarshipService;
  }
}

/**
 * Fastify plugin that registers the scholarship service and routes.
 */
export const scholarshipPlugin = fp(
  async function scholarshipPluginImpl(
    fastify: FastifyInstance,
    options: ScholarshipPluginOptions,
  ) {
    const {
      repository,
      workflowEngine,
      serviceOptions,
      prefix = '/scholarships',
      documentStore,
      documentBlobs,
      resolveLinkedStudentIds,
      applicantExists,
      resolveApplicantAttributes,
      downloadReplayGuard,
    } = options;

    // Create scholarship service instance
    const scholarshipService = new ScholarshipService(repository, workflowEngine, serviceOptions);

    const documentService = new ScholarshipDocumentService({
      documents: documentStore ?? new InMemoryScholarshipDocumentStore(),
      blobs: documentBlobs ?? createScholarshipDocumentBlobStore(),
      scholarshipService,
    });

    // Decorate fastify with the scholarship service
    fastify.decorate('scholarshipService', scholarshipService);

    // Register scholarship routes
    await registerScholarshipRoutes(fastify, {
      scholarshipService,
      prefix,
      resolveLinkedStudentIds,
      applicantExists,
      resolveApplicantAttributes,
    });
    // PRC-H031: drafts can be updated until they are submitted.
    await registerApplicationDraftRoutes(fastify, {
      repository,
      prefix,
      resolveLinkedStudentIds,
    });
    await registerScholarshipDocumentRoutes(fastify, {
      scholarshipService,
      documentService,
      prefix,
      resolveLinkedStudentIds,
      downloadReplayGuard,
    });
  },
  {
    name: '@proctira/backend-scholarship',
    fastify: '5.x',
    dependencies: [],
  },
);
