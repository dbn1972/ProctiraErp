/**
 * Exam document generation worker (P0-06 durable workers spine).
 *
 * Consumes `tenant.*.exam.document.generate` jobs and calls
 * DocumentGenerationService.processJob. Survives process restart when the
 * queue backend retains unacked messages (RabbitMQ) or a shared durable store
 * (InMemoryDurableQueueAdapter for proofs).
 */
import type { ExamDocumentJobPayload } from '@proctira/backend-examination';
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { EXAM_DOCUMENT_CONSUME_TOPIC, EXAM_DOCUMENT_JOB_TYPE } from '@proctira/queue-abstraction';

export interface ExamDocumentWorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ExamDocumentJobProcessor {
  processJob(
    tenantId: string,
    jobId: string,
    options?: { rethrowRetryable?: boolean },
  ): Promise<unknown>;
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
    typeof (payload as ExamDocumentJobPayload).jobId === 'string' &&
    (payload as ExamDocumentJobPayload).jobId.length > 0
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
          // PRC-L103: a valid job requires BOTH the exact message type AND a
          // well-formed payload. The previous `type !== JOB_TYPE && !isPayload`
          // guard let a wrong-typed message carrying a jobId-shaped payload slip
          // through to processJob. Fail closed: reject unless both hold, and
          // throw (nack -> DLQ) for foreign/malformed messages so they are not
          // silently acked and lost.
          if (message.type !== EXAM_DOCUMENT_JOB_TYPE || !isExamDocumentPayload(message.payload)) {
            options.logger?.error(
              { type: message.type, id: message.id },
              'exam-document worker rejected unexpected message',
            );
            throw new Error(
              `Unexpected exam document message ${message.id} (type=${String(message.type)})`,
            );
          }
          const { jobId } = message.payload;
          options.logger?.info(
            { tenantId: message.tenantId, jobId, messageId: message.id },
            'exam-document worker processing job',
          );
          // PRC-M235: transient failures throw so the queue redelivers / dead-letters.
          await options.processor.processJob(message.tenantId, jobId, { rethrowRetryable: true });
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
