/**
 * Optional env-driven report-card TaskQueuePublisher (W2-JOB-02).
 * When QUEUE_BACKEND / RABBITMQ_URL is configured, publishes generation jobs
 * onto the durable queue spine. Otherwise returns null (inline processing
 * remains the assessment-plugin default).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import { createQueueAdapter, createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import type { TaskQueuePublisher } from './report-card-service.js';
import { QueueReportCardPublisher } from './queue-report-card-publisher.js';

export interface ReportCardPublisherHandle {
  publisher: TaskQueuePublisher;
  adapter: QueueAdapter;
  disconnect(): Promise<void>;
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

  let adapter: QueueAdapter;
  if (backend) {
    adapter = createQueueAdapterFromEnv();
  } else {
    adapter = createQueueAdapter({
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

  await adapter.connect();
  return {
    publisher: new QueueReportCardPublisher(adapter),
    adapter,
    disconnect: () => adapter.disconnect(),
  };
}
