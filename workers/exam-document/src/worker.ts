/**
 * Exam document generation worker (P0-06 durable workers spine).
 *
 * Consumes `tenant.*.exam.document.generate` jobs and calls
 * DocumentGenerationService.processJob. Survives process restart when the
 * queue backend retains unacked messages (RabbitMQ) or a shared durable store
 * (InMemoryDurableQueueAdapter for proofs).
 */
import type { ExamDocumentJobPayload } from '@proctira/backend-examination';
import { resolveShutdownTimeoutMs } from '@proctira/common';
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
  /**
   * PRC-M508: max time stop() waits for in-flight handlers before it
   * disconnects (unacked jobs are then redelivered). Defaults to 60% of the
   * graceful-shutdown budget so health/DB teardown still fits inside it.
   */
  drainTimeoutMs?: number;
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
  // PRC-M508: track in-flight handlers so stop() drains them before the queue
  // disconnects. Disconnecting first reclaims (in-memory) or closes the channel
  // under (RabbitMQ) a job that is about to ack, so it would run twice.
  const inFlight = new Set<Promise<unknown>>();
  let stopping = false;
  let stopPromise: Promise<void> | null = null;
  const drainTimeoutMs = options.drainTimeoutMs ?? Math.floor(resolveShutdownTimeoutMs() * 0.6);

  async function drainAndDisconnect(): Promise<void> {
    stopping = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      Promise.allSettled([...inFlight]).then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), drainTimeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (timedOut) {
      options.logger?.error(
        { inFlight: inFlight.size, drainTimeoutMs },
        'exam-document worker drain timed out; unacked jobs will be redelivered',
      );
    }
    // Let the adapter's post-handler ack run before the channel closes.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await options.queue.disconnect();
    running = false;
    stopping = false;
    stopPromise = null;
    options.logger?.info({}, 'exam-document worker stopped');
  }

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
        (message: QueueMessage) => {
          if (stopping) {
            // PRC-M508: neither ack nor nack during the drain. A throw is a
            // retry for every adapter and would burn the retry budget; leaving
            // the delivery unsettled lets disconnect / channel close /
            // visibility timeout redeliver it to the next consumer.
            options.logger?.info(
              { id: message.id, type: message.type },
              'exam-document worker stopping; leaving message for redelivery',
            );
            return new Promise<never>(() => {});
          }
          const handled = (async () => {
            // PRC-L103: a valid job requires BOTH the exact message type AND a
            // well-formed payload. The previous `type !== JOB_TYPE && !isPayload`
            // guard let a wrong-typed message carrying a jobId-shaped payload slip
            // through to processJob. Fail closed: reject unless both hold, and
            // throw (nack -> DLQ) for foreign/malformed messages so they are not
            // silently acked and lost.
            if (
              message.type !== EXAM_DOCUMENT_JOB_TYPE ||
              !isExamDocumentPayload(message.payload)
            ) {
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
          })();
          inFlight.add(handled);
          void handled.then(
            () => inFlight.delete(handled),
            () => inFlight.delete(handled),
          );
          return handled;
        },
      );
      running = true;
      options.logger?.info({ topic }, 'exam-document worker started');
    },
    async stop() {
      if (!running) return;
      // Concurrent stop() calls share one drain + disconnect.
      stopPromise ??= drainAndDisconnect();
      return stopPromise;
    },
  };
}
