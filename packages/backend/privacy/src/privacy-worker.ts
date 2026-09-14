/**
 * Privacy anonymization + tenant offboard durable workers (W1-SEC-06).
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import {
  PRIVACY_ANONYMIZATION_CONSUME_TOPIC,
  PRIVACY_ANONYMIZATION_JOB_TYPE,
  PRIVACY_TENANT_OFFBOARD_CONSUME_TOPIC,
  PRIVACY_TENANT_OFFBOARD_JOB_TYPE,
} from '@proctira/queue-abstraction';

import type {
  PrivacyAnonymizationJobPayload,
  PrivacyTenantOffboardJobPayload,
} from './queue-privacy-publisher.js';

export interface PrivacyWorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface PrivacyAnonymizationProcessor {
  processAnonymizationJob(jobId: string): Promise<unknown>;
}

export interface PrivacyOffboardProcessor {
  processTenantOffboardJob(jobId: string): Promise<unknown>;
}

export interface PrivacyWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

function isAnonymizationPayload(payload: unknown): payload is PrivacyAnonymizationJobPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as PrivacyAnonymizationJobPayload).jobId === 'string' &&
    typeof (payload as PrivacyAnonymizationJobPayload).tenantId === 'string'
  );
}

function isOffboardPayload(payload: unknown): payload is PrivacyTenantOffboardJobPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as PrivacyTenantOffboardJobPayload).jobId === 'string' &&
    typeof (payload as PrivacyTenantOffboardJobPayload).tenantId === 'string'
  );
}

export function createPrivacyAnonymizationWorker(options: {
  queue: QueueAdapter;
  processor: PrivacyAnonymizationProcessor;
  topic?: string;
  groupId?: string;
  logger?: PrivacyWorkerLogger;
}): PrivacyWorker {
  let running = false;
  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      const topic = options.topic ?? PRIVACY_ANONYMIZATION_CONSUME_TOPIC;
      if (!options.queue.isConnected()) {
        await options.queue.connect();
      }
      await options.queue.consume(
        { topic, groupId: options.groupId ?? 'privacy-anonymization-workers', autoAck: false },
        async (message: QueueMessage) => {
          if (
            message.type !== PRIVACY_ANONYMIZATION_JOB_TYPE &&
            !isAnonymizationPayload(message.payload)
          ) {
            options.logger?.error(
              { type: message.type, id: message.id },
              'privacy anonymization worker ignored unexpected message',
            );
            return;
          }
          if (!isAnonymizationPayload(message.payload)) {
            throw new Error(`Invalid privacy anonymization payload on message ${message.id}`);
          }
          const { jobId, tenantId } = message.payload;
          options.logger?.info(
            { tenantId, jobId, messageId: message.id },
            'privacy anonymization worker processing job',
          );
          await options.processor.processAnonymizationJob(jobId);
          options.logger?.info({ tenantId, jobId }, 'privacy anonymization worker completed job');
        },
      );
      running = true;
      options.logger?.info({ topic }, 'privacy anonymization worker started');
    },
    async stop() {
      if (!running) return;
      await options.queue.disconnect();
      running = false;
      options.logger?.info({}, 'privacy anonymization worker stopped');
    },
  };
}

export function createPrivacyOffboardWorker(options: {
  queue: QueueAdapter;
  processor: PrivacyOffboardProcessor;
  topic?: string;
  groupId?: string;
  logger?: PrivacyWorkerLogger;
}): PrivacyWorker {
  let running = false;
  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      const topic = options.topic ?? PRIVACY_TENANT_OFFBOARD_CONSUME_TOPIC;
      if (!options.queue.isConnected()) {
        await options.queue.connect();
      }
      await options.queue.consume(
        { topic, groupId: options.groupId ?? 'privacy-offboard-workers', autoAck: false },
        async (message: QueueMessage) => {
          if (
            message.type !== PRIVACY_TENANT_OFFBOARD_JOB_TYPE &&
            !isOffboardPayload(message.payload)
          ) {
            options.logger?.error(
              { type: message.type, id: message.id },
              'privacy offboard worker ignored unexpected message',
            );
            return;
          }
          if (!isOffboardPayload(message.payload)) {
            throw new Error(`Invalid privacy offboard payload on message ${message.id}`);
          }
          const { jobId, tenantId } = message.payload;
          options.logger?.info(
            { tenantId, jobId, messageId: message.id },
            'privacy offboard worker processing job',
          );
          await options.processor.processTenantOffboardJob(jobId);
          options.logger?.info({ tenantId, jobId }, 'privacy offboard worker completed job');
        },
      );
      running = true;
      options.logger?.info({ topic }, 'privacy offboard worker started');
    },
    async stop() {
      if (!running) return;
      await options.queue.disconnect();
      running = false;
      options.logger?.info({}, 'privacy offboard worker stopped');
    },
  };
}
