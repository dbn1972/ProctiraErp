/**
 * CLI entrypoint for the dedicated privacy worker (PRC-H078).
 *
 * Consumes privacy anonymization + tenant offboard jobs from the durable queue, runs the
 * stuck-job sweeper (PRIVACY_JOB_STUCK_MINUTES, default 15) and serves GET /healthz on
 * PRIVACY_WORKER_HEALTH_PORT (default 8095). Deploy with PRIVACY_WORKERS=external on the
 * gateway; with the default (in-process) both may run — consumers compete on one queue.
 *
 * Env: QUEUE_BACKEND / RABBITMQ_URL / RABBITMQ_EXCHANGE, DATABASE_URL (proctira_app),
 * PRIVACY_FINANCE_HEALTH_ERASURE (see readFinanceHealthErasureMode).
 */
import { AuditService, createAuditRepository } from '@proctira/backend-audit';
import {
  createPrivacyQueuePublishersFromEnv,
  createPrivacyRepository,
  createPrivacyWorkerRuntime,
  PgDomainSubjectAnonymizer,
  PgTenantWipeExecutor,
  readFinanceHealthErasureMode,
  startPrivacyWorkerHealthServer,
} from '@proctira/backend-privacy';
import { registerGracefulShutdown } from '@proctira/common';
import { closeDatabaseResources, getSharedPgPool } from '@proctira/database';
import { readPrivacyWorkerConfig } from './config.js';

const log = (level: 'info' | 'warn' | 'error') => (obj: Record<string, unknown>, msg: string) =>
  console[level](JSON.stringify({ level, msg, service: 'privacy-worker', ...obj }));

async function main(): Promise<void> {
  const config = readPrivacyWorkerConfig();
  const pool = getSharedPgPool();
  if (!pool) throw new Error('Privacy worker could not open the Postgres pool (DATABASE_URL)');
  const queueHandle = await createPrivacyQueuePublishersFromEnv();
  if (!queueHandle) throw new Error('Privacy worker: durable queue is not configured');
  const financeHealthMode = readFinanceHealthErasureMode();
  const auditService = new AuditService(createAuditRepository().repository);
  const runtime = createPrivacyWorkerRuntime({
    repository: createPrivacyRepository(),
    anonymizationQueue: queueHandle.createConsumerAdapter(),
    offboardQueue: queueHandle.createConsumerAdapter(),
    anonymizer: new PgDomainSubjectAnonymizer(pool, { financeHealthMode }),
    tenantWipeExecutor: new PgTenantWipeExecutor(pool, { financeHealthMode }),
    // PRC-M323: privacy lifecycle writes land in the platform audit trail.
    audit: {
      record: async (event) => {
        // System (queue) caller: no client IP.
        await auditService.recordAudit({ ...event, ipAddress: event.ipAddress ?? '0.0.0.0' });
      },
    },
    stuckMinutes: config.stuckMinutes,
    logger: { info: log('info'), error: log('error') },
  });
  const health = await startPrivacyWorkerHealthServer(runtime, config.healthPort);
  registerGracefulShutdown({
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    steps: [
      { name: 'health-server', close: () => new Promise<void>((r) => health.close(() => r())) },
      { name: 'privacy-workers', close: () => runtime.stop() },
      { name: 'queue-publisher', close: () => queueHandle.disconnect() },
      { name: 'database', close: () => closeDatabaseResources() },
    ],
  });
  await runtime.start();
  log('info')({ healthPort: config.healthPort }, 'privacy worker ready');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
