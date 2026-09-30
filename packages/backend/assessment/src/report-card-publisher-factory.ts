/**
 * Optional env-driven report-card TaskQueuePublisher (W2-JOB-02).
 * When QUEUE_BACKEND / RABBITMQ_URL is configured, publishes generation jobs
 * onto the durable queue spine. Otherwise returns null (inline processing
 * remains the assessment-plugin default).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import { createQueueAdapter, createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import { QueueReportCardPublisher } from './queue-report-card-publisher.js';
import type { TaskQueuePublisher } from './report-card-service.js';

export interface ReportCardPublisherHandle {
  publisher: TaskQueuePublisher;
  adapter: QueueAdapter;
  /**
   * PRC-H039: fresh (unconnected) adapter on the same backend for the
   * report-card worker, so worker.stop() does not close the publisher.
   */
  createConsumerAdapter(): QueueAdapter;
  disconnect(): Promise<void>;
}

function buildAdapterFromEnv(
  backend: string | undefined,
  rabbitUrl: string | undefined,
): QueueAdapter {
  if (backend) {
    return createQueueAdapterFromEnv();
  }
  return createQueueAdapter({
    backend: 'rabbitmq',
    rabbitmq: {
      url: rabbitUrl!,
      exchange: process.env['RABBITMQ_EXCHANGE'] ?? 'proctira.events',
      exchangeType: 'topic',
      deadLetterExchange: process.env['RABBITMQ_DLX'] ?? 'dlx',
      durable: true,
    },
  });
}

/**
 * Build a durable report-card publisher from environment, or `null` when
 * queue backends are not configured (dev / unit-test default).
 */
export async function createReportCardPublisherFromEnv(): Promise<ReportCardPublisherHandle | null> {
  const backend = process.env['QUEUE_BACKEND'];
  const rabbitUrl = process.env['RABBITMQ_URL'];

  if (!backend && !rabbitUrl) {
    return null;
  }

  const adapter = buildAdapterFromEnv(backend, rabbitUrl);
  await adapter.connect();
  return {
    publisher: new QueueReportCardPublisher(adapter),
    adapter,
    createConsumerAdapter: () => buildAdapterFromEnv(backend, rabbitUrl),
    disconnect: () => adapter.disconnect(),
  };
}
