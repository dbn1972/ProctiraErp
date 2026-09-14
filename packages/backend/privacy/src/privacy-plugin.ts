/**
 * Fastify Privacy Plugin — legal hold + erasure + correction + offboard (W1-SEC-06).
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { PrivacyAuditPort } from './privacy-audit.js';
import type { PrivacyRepository } from './privacy-repository.js';
import { PrivacyService, type PrivacyServiceOptions } from './privacy-service.js';
import type {
  PrivacyAnonymizationPublisher,
  PrivacyOffboardPublisher,
} from './queue-privacy-publisher.js';
import { registerPrivacyRoutes } from './routes.js';
import type { SubjectAnonymizer, TenantWipeExecutor } from './subject-anonymizer.js';

export interface PrivacyPluginOptions {
  repository: PrivacyRepository;
  /** Route prefix (default: `/privacy`). */
  prefix?: string;
  audit?: PrivacyAuditPort;
  anonymizer?: SubjectAnonymizer;
  tenantWipeExecutor?: TenantWipeExecutor;
  anonymizationPublisher?: PrivacyAnonymizationPublisher;
  offboardPublisher?: PrivacyOffboardPublisher;
}

declare module 'fastify' {
  interface FastifyInstance {
    privacyService: PrivacyService;
  }
}

export const privacyPlugin = fp(
  async function privacyPluginImpl(fastify: FastifyInstance, options: PrivacyPluginOptions) {
    const {
      repository,
      prefix = '/privacy',
      audit,
      anonymizer,
      tenantWipeExecutor,
      anonymizationPublisher,
      offboardPublisher,
    } = options;
    const serviceOptions: PrivacyServiceOptions = {
      audit,
      anonymizer,
      tenantWipeExecutor,
      anonymizationPublisher,
      offboardPublisher,
    };
    const privacyService = new PrivacyService(repository, serviceOptions);
    fastify.decorate('privacyService', privacyService);
    await registerPrivacyRoutes(fastify, { privacyService, prefix });
  },
  { name: '@proctira/backend-privacy', fastify: '5.x', dependencies: [] },
);
