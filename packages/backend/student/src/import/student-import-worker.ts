/**
 * Student import consumer helper (W2-JOB-06).
 *
 * Consumes `tenant.*.student.import` jobs and calls
 * ImportService.processQueuedImport. Survives process restart when the
 * queue backend retains unacked messages (RabbitMQ) or a shared durable store
 * (InMemoryDurableQueueAdapter for proofs). Ack happens only after the handler
 * succeeds (autoAck: false).
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { STUDENT_IMPORT_CONSUME_TOPIC, STUDENT_IMPORT_JOB_TYPE } from '@proctira/queue-abstraction';

import type { StudentImportJobPayload } from './queue-import-queue.js';
import type { ImportOptions } from './types.js';

export interface StudentImportWorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface StudentImportProcessor {
  processQueuedImport(
    tenantId: string,
    jobId: string,
    fileBuffer: Buffer,
    options: ImportOptions,
  ): Promise<unknown>;
}

export interface StudentImportWorkerOptions {
  queue: QueueAdapter;
  processor: StudentImportProcessor;
  topic?: string;
  groupId?: string;
  logger?: StudentImportWorkerLogger;
}

export interface StudentImportWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

function isImportPayload(payload: unknown): payload is StudentImportJobPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as StudentImportJobPayload).jobId === 'string' &&
    typeof (payload as StudentImportJobPayload).tenantId === 'string' &&
    typeof (payload as StudentImportJobPayload).fileBase64 === 'string'
  );
}

export function createStudentImportWorker(
  options: StudentImportWorkerOptions,
): StudentImportWorker {
  let running = false;

  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      const topic = options.topic ?? STUDENT_IMPORT_CONSUME_TOPIC;
      if (!options.queue.isConnected()) {
        await options.queue.connect();
      }
      await options.queue.consume(
        {
          topic,
          groupId: options.groupId ?? 'student-import-workers',
          autoAck: false,
        },
        async (message: QueueMessage) => {
          if (message.type !== STUDENT_IMPORT_JOB_TYPE && !isImportPayload(message.payload)) {
            options.logger?.error(
              { type: message.type, id: message.id },
              'student-import worker ignored unexpected message',
            );
            return;
          }
          if (!isImportPayload(message.payload)) {
            throw new Error(`Invalid student import payload on message ${message.id}`);
          }
          const { jobId, tenantId, fileBase64, options: importOptions } = message.payload;
          options.logger?.info(
            { tenantId, jobId, messageId: message.id },
            'student-import worker processing job',
          );
          const fileBuffer = Buffer.from(fileBase64, 'base64');
          await options.processor.processQueuedImport(tenantId, jobId, fileBuffer, importOptions);
          options.logger?.info({ tenantId, jobId }, 'student-import worker completed job');
        },
      );
      running = true;
      options.logger?.info({ topic }, 'student-import worker started');
    },
    async stop() {
      if (!running) return;
      await options.queue.disconnect();
      running = false;
      options.logger?.info({}, 'student-import worker stopped');
    },
  };
}
