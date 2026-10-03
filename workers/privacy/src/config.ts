/**
 * PRC-H078: privacy worker process configuration (env-driven, fail closed).
 */
export interface PrivacyWorkerConfig {
  healthPort: number;
  stuckMinutes: number | undefined;
}

/** Throws when no durable queue is configured: a worker without a broker has nothing to do. */
export function readPrivacyWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): PrivacyWorkerConfig {
  if (!env['QUEUE_BACKEND'] && !env['RABBITMQ_URL']) {
    throw new Error(
      'Privacy worker requires QUEUE_BACKEND or RABBITMQ_URL (the same broker as the gateway).',
    );
  }
  if (!env['DATABASE_URL']?.trim()) {
    throw new Error('Privacy worker requires DATABASE_URL (runtime role) to process erasures.');
  }
  const port = Number(env['PRIVACY_WORKER_HEALTH_PORT'] ?? '8095');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PRIVACY_WORKER_HEALTH_PORT must be a TCP port (1-65535)');
  }
  const stuck = env['PRIVACY_JOB_STUCK_MINUTES'];
  return { healthPort: port, stuckMinutes: stuck ? Number(stuck) : undefined };
}
