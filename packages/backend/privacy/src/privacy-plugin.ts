/**
 * Fastify Privacy Plugin — legal hold + erasure + correction + offboard (W1-SEC-06).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { PrivacyAuditPort } from './privacy-audit.js';
import type { PrivacyRepository } from './privacy-repository.js';
import { PrivacyService, type PrivacyServiceOptions } from './privacy-service.js';
import {
  createPrivacyAnonymizationWorker,
  createPrivacyOffboardWorker,
  type PrivacyWorker,
} from './privacy-worker.js';
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
  /**
   * PRC-H078: dedicated queue adapters the in-process anonymization / offboard
   * workers consume from (started onReady, stopped onClose). A publisher
   * without its worker queue falls back to inline processing so jobs are
   * never enqueued with no consumer.
   */
  anonymizationWorkerQueue?: QueueAdapter;
  offboardWorkerQueue?: QueueAdapter;
}

declare module 'fastify' {
  interface FastifyInstance {
    privacyService: PrivacyService;
    privacyWorkers?: PrivacyWorker[];
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
      anonymizationWorkerQueue,
      offboardWorkerQueue,
    } = options;
    const effectiveAnonymizationPublisher = anonymizationWorkerQueue
      ? anonymizationPublisher
      : undefined;
    const effectiveOffboardPublisher = offboardWorkerQueue ? offboardPublisher : undefined;
    if (
      (anonymizationPublisher && !anonymizationWorkerQueue) ||
      (offboardPublisher && !offboardWorkerQueue)
    ) {
      fastify.log.warn('privacy queue publisher configured without a consumer; processing inline');
    }
    const serviceOptions: PrivacyServiceOptions = {
      audit,
      anonymizer,
      tenantWipeExecutor,
      anonymizationPublisher: effectiveAnonymizationPublisher,
      offboardPublisher: effectiveOffboardPublisher,
    };
    const privacyService = new PrivacyService(repository, serviceOptions);
    fastify.decorate('privacyService', privacyService);

    const workerLogger = {
      info: (obj: Record<string, unknown>, msg: string) => fastify.log.info(obj, msg),
      error: (obj: Record<string, unknown>, msg: string) => fastify.log.error(obj, msg),
    };
    const workers: PrivacyWorker[] = [];
    if (effectiveAnonymizationPublisher && anonymizationWorkerQueue) {
      workers.push(
        createPrivacyAnonymizationWorker({
          queue: anonymizationWorkerQueue,
          processor: privacyService,
          logger: workerLogger,
        }),
      );
    }
    if (effectiveOffboardPublisher && offboardWorkerQueue) {
      workers.push(
        createPrivacyOffboardWorker({
          queue: offboardWorkerQueue,
          processor: privacyService,
          logger: workerLogger,
        }),
      );
    }
    if (workers.length > 0) {
      fastify.decorate('privacyWorkers', workers);
      fastify.addHook('onReady', async () => {
        for (const worker of workers) await worker.start();
      });
      fastify.addHook('onClose', async () => {
        for (const worker of workers) await worker.stop();
      });
    }
    await registerPrivacyRoutes(fastify, { privacyService, prefix });
  },
  { name: '@proctira/backend-privacy', fastify: '5.x', dependencies: [] },
);
