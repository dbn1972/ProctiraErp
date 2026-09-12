/**
 * Exam document generation worker (P0-06 durable workers spine).
 *
 * Consumes `tenant.*.exam.document.generate` jobs and calls
 * DocumentGenerationService.processJob. Survives process restart when the
 * queue backend retains unacked messages (RabbitMQ) or a shared durable store
 * (InMemoryDurableQueueAdapter for proofs).
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { EXAM_DOCUMENT_CONSUME_TOPIC, EXAM_DOCUMENT_JOB_TYPE } from '@proctira/queue-abstraction';
import type { ExamDocumentJobPayload } from '@proctira/backend-examination';

export interface ExamDocumentWorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ExamDocumentJobProcessor {
  processJob(tenantId: string, jobId: string): Promise<unknown>;
}

export interface ExamDocumentWorkerOptions {
  queue: QueueAdapter;
  processor: ExamDocumentJobProcessor;
  /** RabbitMQ / memory consume topic pattern (default: all tenants). */
  topic?: string;
  groupId?: string;
  logger?: ExamDocumentWorkerLogger;
}

export interface ExamDocumentWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

function isExamDocumentPayload(payload: unknown): payload is ExamDocumentJobPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as ExamDocumentJobPayload).jobId === 'string'
  );
}

export function createExamDocumentWorker(options: ExamDocumentWorkerOptions): ExamDocumentWorker {
  let running = false;

  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      const topic = options.topic ?? EXAM_DOCUMENT_CONSUME_TOPIC;
      if (!options.queue.isConnected()) {
        await options.queue.connect();
      }
      await options.queue.consume(
        {
          topic,
          groupId: options.groupId ?? 'exam-document-workers',
          autoAck: false,
        },
        async (message: QueueMessage) => {
          if (message.type !== EXAM_DOCUMENT_JOB_TYPE && !isExamDocumentPayload(message.payload)) {
            options.logger?.error(
              { type: message.type, id: message.id },
              'exam-document worker ignored unexpected message',
            );
            return;
          }
          if (!isExamDocumentPayload(message.payload)) {
            throw new Error(`Invalid exam document payload on message ${message.id}`);
          }
          const { jobId } = message.payload;
          options.logger?.info(
            { tenantId: message.tenantId, jobId, messageId: message.id },
            'exam-document worker processing job',
          );
          await options.processor.processJob(message.tenantId, jobId);
          options.logger?.info(
            { tenantId: message.tenantId, jobId },
            'exam-document worker completed job',
          );
        },
      );
      running = true;
      options.logger?.info({ topic }, 'exam-document worker started');
    },
    async stop() {
      if (!running) return;
      await options.queue.disconnect();
      running = false;
      options.logger?.info({}, 'exam-document worker stopped');
    },
  };
}
