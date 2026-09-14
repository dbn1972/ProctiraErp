/**
 * Report-card generation consumer helper (W2-JOB-02).
 *
 * Consumes `tenant.*.report-card.generate` jobs and calls
 * ReportCardService.processReportCardJob. Survives process restart when the
 * queue backend retains unacked messages (RabbitMQ) or a shared durable store
 * (InMemoryDurableQueueAdapter for proofs). Ack happens only after the handler
 * succeeds (autoAck: false).
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { REPORT_CARD_CONSUME_TOPIC, REPORT_CARD_JOB_TYPE } from '@proctira/queue-abstraction';

import type { ReportCardGenerateJobPayload } from './queue-report-card-publisher.js';

export interface ReportCardWorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ReportCardJobProcessor {
  processReportCardJob(tenantId: string, jobId: string): Promise<unknown>;
  /** Re-dispatch orphaned DB rows left by create→publish dual-write crashes. */
  reclaimQueuedJobs?(tenantId: string): Promise<number>;
}

export interface ReportCardWorkerOptions {
  queue: QueueAdapter;
  processor: ReportCardJobProcessor;
  /** Optional tenant to reclaim orphaned queued jobs on start. */
  reclaimTenantId?: string;
  topic?: string;
  groupId?: string;
  logger?: ReportCardWorkerLogger;
}

export interface ReportCardWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

function isReportCardPayload(payload: unknown): payload is ReportCardGenerateJobPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as ReportCardGenerateJobPayload).jobId === 'string'
  );
}

export function createReportCardWorker(options: ReportCardWorkerOptions): ReportCardWorker {
  let running = false;

  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      const topic = options.topic ?? REPORT_CARD_CONSUME_TOPIC;
      if (!options.queue.isConnected()) {
        await options.queue.connect();
      }

      if (options.reclaimTenantId && options.processor.reclaimQueuedJobs) {
        const n = await options.processor.reclaimQueuedJobs(options.reclaimTenantId);
        options.logger?.info(
          { tenantId: options.reclaimTenantId, reclaimed: n },
          'report-card worker reclaimed queued jobs',
        );
      }

      await options.queue.consume(
        {
          topic,
          groupId: options.groupId ?? 'report-card-workers',
          autoAck: false,
        },
        async (message: QueueMessage) => {
          if (message.type !== REPORT_CARD_JOB_TYPE && !isReportCardPayload(message.payload)) {
            options.logger?.error(
              { type: message.type, id: message.id },
              'report-card worker ignored unexpected message',
            );
            return;
          }
          if (!isReportCardPayload(message.payload)) {
            throw new Error(`Invalid report-card payload on message ${message.id}`);
          }
          const { jobId } = message.payload;
          options.logger?.info(
            { tenantId: message.tenantId, jobId, messageId: message.id },
            'report-card worker processing job',
          );
          await options.processor.processReportCardJob(message.tenantId, jobId);
          options.logger?.info(
            { tenantId: message.tenantId, jobId },
            'report-card worker completed job',
          );
        },
      );
      running = true;
      options.logger?.info({ topic }, 'report-card worker started');
    },
    async stop() {
      if (!running) return;
      await options.queue.disconnect();
      running = false;
      options.logger?.info({}, 'report-card worker stopped');
    },
  };
}
