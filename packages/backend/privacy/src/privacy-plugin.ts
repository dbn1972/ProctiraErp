/**
 * Fastify Privacy Plugin — legal hold + erasure + correction + offboard (W1-SEC-06).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { CorrectionApplier } from './correction-applier.js';
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
  /** PRC-M321: domain rectification writer; absent -> correction apply returns 501. */
  correctionApplier?: CorrectionApplier;
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
  /**
   * PRC-H078: stuck-job sweeper. Enabled by default when a durable worker is
   * wired; `stuckMinutes` defaults to PRIVACY_JOB_STUCK_MINUTES (15).
   */
  sweeper?: { enabled?: boolean; stuckMinutes?: number; intervalMs?: number };
}

declare module 'fastify' {
  interface FastifyInstance {
    privacyService: PrivacyService;
    privacyWorkers?: PrivacyWorker[];
    privacyStuckJobSweep?: () => Promise<void>;
  }
}

/** PRC-H078: PRIVACY_JOB_STUCK_MINUTES (positive integer, default 15). */
export function readPrivacyJobStuckMinutes(
  env: Record<string, string | undefined> = process.env,
): number {
  const n = Number(env['PRIVACY_JOB_STUCK_MINUTES']);
  return Number.isInteger(n) && n > 0 ? n : 15;
}

export const privacyPlugin = fp(
  async function privacyPluginImpl(fastify: FastifyInstance, options: PrivacyPluginOptions) {
    const {
      repository,
      prefix = '/privacy',
      audit,
      correctionApplier,
      anonymizer,
      tenantWipeExecutor,
      anonymizationPublisher,
      offboardPublisher,
      anonymizationWorkerQueue,
      offboardWorkerQueue,
      sweeper,
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
      correctionApplier,
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
    // PRC-H078: stuck-job sweeper (PRIVACY_JOB_STUCK_MINUTES, default 15).
    const stuckMinutes = sweeper?.stuckMinutes ?? readPrivacyJobStuckMinutes();
    if (sweeper?.enabled ?? workers.length > 0) {
      const intervalMs = sweeper?.intervalMs ?? Math.min(stuckMinutes, 5) * 60_000;
      let timer: ReturnType<typeof setInterval> | undefined;
      let sweeping = false;
      const sweep = async () => {
        if (sweeping) return;
        sweeping = true;
        try {
          const r = await privacyService.sweepStuckJobs(stuckMinutes);
          if (r.scanned > 0) fastify.log.info(r, 'privacy stuck-job sweep');
        } catch (err) {
          fastify.log.error({ err: String(err) }, 'privacy stuck-job sweep failed');
        } finally {
          sweeping = false;
        }
      };
      fastify.decorate('privacyStuckJobSweep', sweep);
      fastify.addHook('onReady', async () => {
        timer = setInterval(() => void sweep(), intervalMs);
        timer.unref?.();
      });
      fastify.addHook('onClose', async () => {
        if (timer) clearInterval(timer);
      });
    }

    await registerPrivacyRoutes(fastify, { privacyService, prefix });
  },
  { name: '@proctira/backend-privacy', fastify: '5.x', dependencies: [] },
);
