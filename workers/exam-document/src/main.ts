/**
 * CLI entrypoint for the exam document durable worker.
 *
 * Env:
 * - QUEUE_BACKEND / RABBITMQ_* — required for live broker consumption
 * - DATABASE_URL — optional; examination repos use PG when set
 */
import { pathToFileURL } from 'node:url';

import {
  createDocumentBlobStore,
  createDocumentRepository,
  createExaminationRepository,
  type DocumentBlobStore,
  DocumentGenerationService,
  NoOpDocumentTaskQueue,
  SimplePdfGenerator,
} from '@proctira/backend-examination';
import { registerGracefulShutdown } from '@proctira/common';
import { closeDatabaseResources } from '@proctira/database';
import { createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import { startHealthServer } from './health-server.js';
import { createExamDocumentWorker } from './worker.js';

/**
 * PRC-H052: resolve the durable DocumentBlobStore for the worker.
 *
 * The worker generates PDFs in a separate process from the API. Without a
 * durable, shared blob store the bytes live only in this worker's heap, so the
 * API download path returns 404 (and a worker restart loses every PDF while the
 * job row still reads 'completed'). We inject the Postgres-backed
 * DocumentBlobStore (db/sql/125) so worker-written PDFs are persisted and
 * downloadable by any API/worker process.
 *
 * Fails closed in production: an in-memory fallback here would silently 404
 * downloads, so refuse to start without a durable store.
 */
export function resolveWorkerBlobStore(
  factory: () => DocumentBlobStore | null = createDocumentBlobStore,
  env: NodeJS.ProcessEnv = process.env,
): DocumentBlobStore | undefined {
  const blobStore = factory() ?? undefined;
  if (!blobStore && env['NODE_ENV'] === 'production') {
    throw new Error(
      'PRC-H052: no durable DocumentBlobStore configured (DATABASE_URL unset); ' +
        'refusing to run the exam document worker with a process-local store in production ' +
        'because generated PDFs would never be downloadable via the API.',
    );
  }
  return blobStore;
}

/**
 * Build the DocumentGenerationService used by the worker, wiring the durable
 * blob store (PRC-H052). Exported for tests.
 */
export function buildDocumentGenerationService(
  blobStore: DocumentBlobStore | undefined = resolveWorkerBlobStore(),
): DocumentGenerationService {
  return new DocumentGenerationService(
    createExaminationRepository(),
    createDocumentRepository(),
    new SimplePdfGenerator(),
    new NoOpDocumentTaskQueue(),
    blobStore,
  );
}

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

  // PRC-H052: inject the durable (Postgres-backed) blob store; fail closed in
  // production when DATABASE_URL is unset.
  const service = buildDocumentGenerationService(resolveWorkerBlobStore());

  const worker = createExamDocumentWorker({
    queue,
    processor: service,
    logger: {
      info: (obj, msg) => console.info(JSON.stringify({ level: 'info', msg, ...obj })),
      error: (obj, msg) => console.error(JSON.stringify({ level: 'error', msg, ...obj })),
    },
  });

  // PRC-H051: liveness/readiness probe for compose/k8s. Readiness tracks the
  // worker's running state and broker connectivity.
  const health = await startHealthServer({
    worker: {
      get running() {
        return worker.running;
      },
      isConnected: () => queue.isConnected(),
    },
  });

  // W1-ARCH-07: drain queue consumer → close DB pools → exit (timeout + second-signal force).
  registerGracefulShutdown({
    logger: {
      info: (obj, msg) => console.info(JSON.stringify({ level: 'info', msg, ...obj })),
      warn: (obj, msg) => console.warn(JSON.stringify({ level: 'warn', msg, ...obj })),
      error: (obj, msg) => console.error(JSON.stringify({ level: 'error', msg, ...obj })),
    },
    steps: [
      {
        name: 'health-server',
        close: async () => {
          await health.close();
        },
      },
      {
        name: 'queue-worker',
        close: async () => {
          await worker.stop();
        },
      },
      {
        name: 'database',
        close: () => closeDatabaseResources(),
      },
    ],
  });

  await worker.start();
  console.info(JSON.stringify({ level: 'info', msg: 'exam-document worker ready' }));
}

// Only auto-run when invoked directly as the CLI entrypoint (not on import by
// tests), so the exported builders above can be unit-tested in isolation.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
