/**
 * Fastify Transport Plugin
 *
 * Registers transport routes and service on a Fastify instance.
 * Provides the transport service as a decorator for other plugins to use.
 *
 * Requirements: 1.2 (Transport_Module)
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { TransportFeesPort } from './fees-port.js';
import { registerTransportRoutes } from './routes.js';
import type { TransportRepository } from './transport-repository.js';
import { TransportService } from './transport-service.js';

/**
 * Options for the transport plugin.
 */
export interface TransportPluginOptions {
  /** Transport repository implementation */
  repository: TransportRepository;
  /** Route prefix for transport (default: '/transport') */
  prefix?: string;
  /** Optional G-903 fees port (injected by api-gateway). */
  feesService?: TransportFeesPort;
  /**
   * PRC-M451 (DR35): GPS retention sweep. Defaults: on outside NODE_ENV=test
   * unless TRANSPORT_GPS_RETENTION_SWEEP=0; interval TRANSPORT_GPS_RETENTION_INTERVAL_MS
   * (default 6 h, minimum 60 s).
   */
  gpsRetentionSweep?: { enabled?: boolean; intervalMs?: number };
}
/** PRC-M451: default GPS retention sweep interval. */
export const DEFAULT_GPS_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
export function gpsRetentionSweepSettings(
  env: NodeJS.ProcessEnv = process.env,
  override: TransportPluginOptions['gpsRetentionSweep'] = {},
): { enabled: boolean; intervalMs: number } {
  const enabled =
    override.enabled ??
    (env['TRANSPORT_GPS_RETENTION_SWEEP'] !== '0' && env['NODE_ENV'] !== 'test');
  const configured =
    override.intervalMs ?? Number(env['TRANSPORT_GPS_RETENTION_INTERVAL_MS'] ?? '');
  const intervalMs =
    Number.isFinite(configured) && configured > 0
      ? Math.max(60_000, configured)
      : DEFAULT_GPS_RETENTION_INTERVAL_MS;
  return { enabled, intervalMs };
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    transportService: TransportService;
  }
}

/**
 * Fastify plugin that registers the transport service and routes.
 */
export const transportPlugin = fp(
  async function transportPluginImpl(fastify: FastifyInstance, options: TransportPluginOptions) {
    const { repository, prefix = '/transport', feesService } = options;

    // Create transport service instance
    const transportService = new TransportService(repository, undefined, feesService);

    // Decorate fastify with the transport service
    fastify.decorate('transportService', transportService);

    // Register transport routes
    await registerTransportRoutes(fastify, {
      transportService,
      prefix,
    });
    // PRC-M451 (DR35): erase GPS pings past the 90-day window on an interval,
    // single-flight per replica (the DELETE is idempotent across replicas).
    const sweepSettings = gpsRetentionSweepSettings(process.env, options.gpsRetentionSweep);
    if (sweepSettings.enabled) {
      let timer: ReturnType<typeof setInterval> | undefined;
      let sweeping = false;
      const sweep = async () => {
        if (sweeping) return;
        sweeping = true;
        try {
          const result = await transportService.runGpsRetentionSweep();
          if (result.failures.length > 0) {
            fastify.log.error(result, 'transport GPS retention sweep had failures');
          } else if (result.erased > 0) {
            fastify.log.info(result, 'transport GPS retention sweep');
          }
        } catch (err) {
          fastify.log.error({ err: String(err) }, 'transport GPS retention sweep failed');
        } finally {
          sweeping = false;
        }
      };
      fastify.addHook('onReady', async () => {
        timer = setInterval(() => void sweep(), sweepSettings.intervalMs);
        timer.unref?.();
      });
      fastify.addHook('onClose', async () => {
        if (timer) clearInterval(timer);
      });
    }
  },
  {
    name: '@proctira/backend-transport',
    fastify: '5.x',
    dependencies: [],
  },
);
