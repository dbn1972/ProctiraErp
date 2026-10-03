/**
 * PRC-H078: dedicated privacy worker runtime.
 *
 * Builds the PrivacyService plus the anonymization / offboard consumers and the stuck-job
 * sweeper outside the API gateway, so `workers/privacy` (compose service + Helm Deployment)
 * can run them as their own process with a health endpoint. The gateway keeps publishing
 * (PRIVACY_WORKERS=external) or keeps its in-process consumers (default).
 */
import { createServer, type Server } from 'node:http';
import type { QueueAdapter } from '@proctira/queue-abstraction';
import type { CorrectionApplier } from './correction-applier.js';
import type { PrivacyAuditPort } from './privacy-audit.js';
import { readPrivacyJobStuckMinutes } from './privacy-plugin.js';
import type { PrivacyRepository } from './privacy-repository.js';
import { PrivacyService } from './privacy-service.js';
import {
  createPrivacyAnonymizationWorker,
  createPrivacyOffboardWorker,
  type PrivacyWorker,
  type PrivacyWorkerLogger,
} from './privacy-worker.js';
import type { SubjectAnonymizer, TenantWipeExecutor } from './subject-anonymizer.js';

export type PrivacyWorkersMode = 'in-process' | 'external';

/**
 * PRIVACY_WORKERS: where the durable privacy consumers run.
 * - `in-process` (default): the gateway consumes; jobs always have a consumer.
 * - `external`: the gateway only publishes; `workers/privacy` must be deployed.
 */
export function readPrivacyWorkersMode(
  env: Record<string, string | undefined> = process.env,
): PrivacyWorkersMode {
  return env['PRIVACY_WORKERS']?.trim().toLowerCase() === 'external' ? 'external' : 'in-process';
}

export interface PrivacyWorkerRuntimeOptions {
  repository: PrivacyRepository;
  anonymizationQueue: QueueAdapter;
  offboardQueue: QueueAdapter;
  anonymizer?: SubjectAnonymizer;
  tenantWipeExecutor?: TenantWipeExecutor;
  audit?: PrivacyAuditPort;
  correctionApplier?: CorrectionApplier;
  logger?: PrivacyWorkerLogger;
  /** Default PRIVACY_JOB_STUCK_MINUTES (15). */
  stuckMinutes?: number;
  /** Sweep interval; default min(stuckMinutes, 5) minutes. 0 disables the timer. */
  sweepIntervalMs?: number;
}

export interface PrivacyWorkerHealth {
  ok: boolean;
  workers: { name: string; running: boolean; queueConnected: boolean }[];
  lastSweepError: string | null;
}

export interface PrivacyWorkerRuntime {
  readonly service: PrivacyService;
  readonly workers: readonly PrivacyWorker[];
  start(): Promise<void>;
  stop(): Promise<void>;
  sweep(): Promise<{ scanned: number; retried: number; failed: number }>;
  health(): PrivacyWorkerHealth;
}

export function createPrivacyWorkerRuntime(
  options: PrivacyWorkerRuntimeOptions,
): PrivacyWorkerRuntime {
  const service = new PrivacyService(options.repository, {
    audit: options.audit,
    correctionApplier: options.correctionApplier,
    anonymizer: options.anonymizer,
    tenantWipeExecutor: options.tenantWipeExecutor,
  });
  const named: { name: string; worker: PrivacyWorker; queue: QueueAdapter }[] = [
    {
      name: 'anonymization',
      queue: options.anonymizationQueue,
      worker: createPrivacyAnonymizationWorker({
        queue: options.anonymizationQueue,
        processor: service,
        logger: options.logger,
      }),
    },
    {
      name: 'offboard',
      queue: options.offboardQueue,
      worker: createPrivacyOffboardWorker({
        queue: options.offboardQueue,
        processor: service,
        logger: options.logger,
      }),
    },
  ];
  const stuckMinutes = options.stuckMinutes ?? readPrivacyJobStuckMinutes();
  const intervalMs = options.sweepIntervalMs ?? Math.min(stuckMinutes, 5) * 60_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sweeping: Promise<{ scanned: number; retried: number; failed: number }> | null = null;
  let lastSweepError: string | null = null;

  const sweep = async () => {
    if (sweeping) return sweeping;
    sweeping = service
      .sweepStuckJobs(stuckMinutes)
      .then((r) => {
        lastSweepError = null;
        if (r.scanned > 0) options.logger?.info({ ...r }, 'privacy stuck-job sweep');
        return r;
      })
      .catch((err: unknown) => {
        lastSweepError = err instanceof Error ? err.message : String(err);
        options.logger?.error({ err: lastSweepError }, 'privacy stuck-job sweep failed');
        return { scanned: 0, retried: 0, failed: 0 };
      })
      .finally(() => {
        sweeping = null;
      });
    return sweeping;
  };

  return {
    service,
    workers: named.map((n) => n.worker),
    async start() {
      for (const { worker } of named) await worker.start();
      if (intervalMs > 0) {
        timer = setInterval(() => void sweep(), intervalMs);
        timer.unref?.();
      }
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      for (const { worker } of named) await worker.stop();
    },
    sweep,
    health() {
      const workers = named.map(({ name, worker, queue }) => ({
        name,
        running: worker.running,
        queueConnected: queue.isConnected(),
      }));
      return {
        ok: workers.every((w) => w.running && w.queueConnected),
        workers,
        lastSweepError,
      };
    },
  };
}

/**
 * Minimal liveness/readiness endpoint for the dedicated worker: `GET /healthz` returns 200
 * when both consumers run on connected queues, else 503. Binds to `host` (default 0.0.0.0
 * inside the container network; the port is not exposed publicly) and serves no other path.
 */
export function startPrivacyWorkerHealthServer(
  runtime: Pick<PrivacyWorkerRuntime, 'health'>,
  port: number,
  host = '0.0.0.0',
): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || (req.url !== '/healthz' && req.url !== '/readyz')) {
      res.writeHead(404).end();
      return;
    }
    const health = runtime.health();
    res
      .writeHead(health.ok ? 200 : 503, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: health.ok ? 'ok' : 'unavailable', workers: health.workers }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
