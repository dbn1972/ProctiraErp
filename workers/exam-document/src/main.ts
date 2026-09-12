/**
 * CLI entrypoint for the exam document durable worker.
 *
 * Env:
 * - QUEUE_BACKEND / RABBITMQ_* — required for live broker consumption
 * - DATABASE_URL — optional; examination repos use PG when set
 */
import {
  createDocumentRepository,
  createExaminationRepository,
  DocumentGenerationService,
  SimplePdfGenerator,
} from '@proctira/backend-examination';
import { createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import { createExamDocumentWorker } from './worker.js';

async function main(): Promise<void> {
  if (!process.env['QUEUE_BACKEND'] && !process.env['RABBITMQ_URL']) {
    throw new Error(
      'Exam document worker requires QUEUE_BACKEND or RABBITMQ_URL. ' +
        'Set QUEUE_BACKEND=rabbitmq and RABBITMQ_URL / RABBITMQ_EXCHANGE.',
    );
  }

  if (!process.env['QUEUE_BACKEND'] && process.env['RABBITMQ_URL']) {
    process.env['QUEUE_BACKEND'] = 'rabbitmq';
    process.env['RABBITMQ_EXCHANGE'] ??= 'proctira.events';
  }

  const queue = createQueueAdapterFromEnv();
  const service = new DocumentGenerationService(
    createExaminationRepository(),
    createDocumentRepository(),
    new SimplePdfGenerator(),
  );

  const worker = createExamDocumentWorker({
    queue,
    processor: service,
    logger: {
      info: (obj, msg) => console.info(JSON.stringify({ level: 'info', msg, ...obj })),
      error: (obj, msg) => console.error(JSON.stringify({ level: 'error', msg, ...obj })),
    },
  });

  const shutdown = async (signal: string) => {
    console.info(JSON.stringify({ level: 'info', msg: 'shutting down', signal }));
    await worker.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await worker.start();
  console.info(JSON.stringify({ level: 'info', msg: 'exam-document worker ready' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
