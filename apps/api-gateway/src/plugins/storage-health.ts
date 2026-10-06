/**
 * Object-storage health probe for install CLI + ops.
 *
 * GET /api/v1/storage/health
 * - 200 when S3_/MinIO credentials are present and HeadBucket (+ optional
 *   put/get/delete round-trip) succeeds
 * - 503 when unconfigured or unhealthy (honest — never invents success)
 *
 * Peer-gap #8: live storage connector when compose MinIO / S3_* exist.
 * Live Twilio SMS remains waived until secrets are available.
 */

import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import {
  createStorageAdapter,
  type AdapterHealth,
  type StorageAdapter,
  type StorageAdapterConfig,
} from '@proctira/storage';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { PLATFORM_ADMIN_ROLE_IDS } from '../rbac-registry.js';

export interface StorageHealthOptions {
  /** Override adapter (tests). When omitted, built from env. */
  adapter?: StorageAdapter | null;
  /**
   * Run the put/get/delete round-trip. PRC-M023: default false (HeadBucket only);
   * enable with `STORAGE_HEALTH_ROUND_TRIP=1` or this option.
   */
  roundTrip?: boolean;
  /** Seconds a probe result is reused (PRC-M023). Default 30; 0 disables. */
  cacheSeconds?: number;
  /**
   * Caller authorisation (PRC-M023). Default: a verified platform admin
   * (`platform_admin` / `super-admin`). Anything else → 401/403.
   */
  authorize?: (request: FastifyRequest) => 'ok' | 'unauthenticated' | 'forbidden';
  /** Tenant id used for probe object namespace. */
  probeTenantId?: string;
}

export interface StorageEnvConfig {
  endpoint?: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
  bucket?: string;
  forcePathStyle?: boolean;
}

export function readStorageEnv(env: NodeJS.ProcessEnv = process.env): StorageEnvConfig {
  return {
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    region: env.S3_REGION?.trim() || 'us-east-1',
    accessKey: env.S3_ACCESS_KEY?.trim() || undefined,
    secretKey: env.S3_SECRET_KEY?.trim() || undefined,
    bucket: env.S3_BUCKET?.trim() || undefined,
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() !== 'false',
  };
}

export function isStorageConfigured(config: StorageEnvConfig): boolean {
  return Boolean(config.bucket && config.accessKey && config.secretKey);
}

export function buildStorageAdapterConfig(config: StorageEnvConfig): StorageAdapterConfig | null {
  if (!isStorageConfigured(config) || !config.bucket || !config.accessKey || !config.secretKey) {
    return null;
  }

  if (config.endpoint) {
    return {
      adapter: 'minio',
      config: {
        bucket: config.bucket,
        endpoint: config.endpoint,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        region: config.region,
      },
    };
  }

  return {
    adapter: 's3',
    config: {
      bucket: config.bucket,
      region: config.region ?? 'us-east-1',
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
      forcePathStyle: config.forcePathStyle,
    },
  };
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk, 'utf8'));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(chunk);
    } else {
      chunks.push(Uint8Array.from(chunk as Iterable<number>));
    }
  }
  return Buffer.concat(chunks);
}

export async function runStorageHealthProbe(
  adapter: StorageAdapter,
  options?: { roundTrip?: boolean; probeTenantId?: string },
): Promise<{
  healthy: boolean;
  roundTrip: boolean;
  health: AdapterHealth;
  message: string;
  /** Raw failure detail — server-side logging only, never returned to callers. */
  detail?: string;
}> {
  const health = await adapter.healthCheck();
  if (!health.healthy) {
    return {
      healthy: false,
      roundTrip: false,
      health,
      message: 'Object storage health check failed',
      detail: health.message,
    };
  }

  const doRoundTrip = options?.roundTrip !== false;
  if (!doRoundTrip) {
    return {
      healthy: true,
      roundTrip: false,
      health,
      message: health.message,
    };
  }

  const tenantId = options?.probeTenantId ?? 'system-health';
  const objectKey = `probes/${randomUUID()}.txt`;
  const payload = Buffer.from(`proctira-storage-probe:${new Date().toISOString()}`, 'utf8');

  try {
    const uploaded = await adapter.upload(objectKey, payload, {
      tenantId,
      contentType: 'text/plain',
      lifecycle: 'temporary',
    });
    const downloaded = await streamToBuffer(await adapter.download(uploaded.key));
    if (!downloaded.equals(payload)) {
      return {
        healthy: false,
        roundTrip: true,
        health,
        message: 'Object storage round-trip payload mismatch',
      };
    }
    await adapter.delete(uploaded.key);
    return {
      healthy: true,
      roundTrip: true,
      health,
      message: 'Object storage read/write verified',
    };
  } catch (error) {
    return {
      healthy: false,
      roundTrip: true,
      health,
      message: 'Object storage round-trip failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function defaultAuthorize(request: FastifyRequest): 'ok' | 'unauthenticated' | 'forbidden' {
  const user = (request as unknown as { user?: { roles?: Array<string | { roleId: string }> } })
    .user;
  if (!user) return 'unauthenticated';
  const isPlatformAdmin = (user.roles ?? []).some((r) =>
    PLATFORM_ADMIN_ROLE_IDS.has(typeof r === 'string' ? r : r.roleId),
  );
  return isPlatformAdmin ? 'ok' : 'forbidden';
}

/** Public-safe message: never echo endpoint, bucket or SDK error text (PRC-M023). */
function genericMessage(healthy: boolean, roundTrip: boolean): string {
  if (healthy) return roundTrip ? 'Object storage read/write verified' : 'Object storage reachable';
  return 'Object storage unavailable';
}

const storageHealthPlugin: FastifyPluginAsync<StorageHealthOptions> = async (
  fastify: FastifyInstance,
  options: StorageHealthOptions,
) => {
  const authorize = options.authorize ?? defaultAuthorize;
  const roundTrip = options.roundTrip ?? process.env['STORAGE_HEALTH_ROUND_TRIP'] === '1';
  const cacheMs = Math.max(0, options.cacheSeconds ?? 30) * 1000;
  let cached: { at: number; statusCode: 200 | 503; body: Record<string, unknown> } | undefined;
  let inFlight: Promise<{ statusCode: 200 | 503; body: Record<string, unknown> }> | undefined;

  fastify.get(
    '/api/v1/storage/health',
    {
      schema: {
        description: 'Object storage health + optional put/get/delete probe',
        tags: ['Health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              mode: { type: 'string' },
              roundTrip: { type: 'boolean' },
              message: { type: 'string' },
              adapter: { type: 'string' },
              latencyMs: { type: 'number' },
              checkedAt: { type: 'string' },
            },
          },
          401: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              mode: { type: 'string' },
              roundTrip: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
          403: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              mode: { type: 'string' },
              roundTrip: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              mode: { type: 'string' },
              roundTrip: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const decision = authorize(request);
      if (decision !== 'ok') {
        const statusCode = decision === 'unauthenticated' ? 401 : 403;
        return reply.status(statusCode).send({
          status: statusCode === 401 ? 'unauthorized' : 'forbidden',
          mode: 'denied',
          roundTrip: false,
          message:
            statusCode === 401 ? 'Authentication required' : 'Platform administrator role required',
        });
      }
      if (cached && Date.now() - cached.at < cacheMs) {
        return reply.status(cached.statusCode).send(cached.body);
      }
      inFlight ??= probe(request).finally(() => {
        inFlight = undefined;
      });
      const result = await inFlight;
      if (cacheMs > 0) cached = { at: Date.now(), ...result };
      return reply.status(result.statusCode).send(result.body);
    },
  );

  async function probe(
    request: FastifyRequest,
  ): Promise<{ statusCode: 200 | 503; body: Record<string, unknown> }> {
    let adapter = options.adapter;
    if (adapter === undefined) {
      const adapterConfig = buildStorageAdapterConfig(readStorageEnv());
      if (!adapterConfig) {
        return {
          statusCode: 503,
          body: {
            status: 'unconfigured',
            mode: 'unconfigured',
            roundTrip: false,
            message:
              'Object storage not configured (set S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY; optional S3_ENDPOINT for MinIO)',
          },
        };
      }
      adapter = createStorageAdapter(adapterConfig);
    }
    if (adapter === null) {
      return {
        statusCode: 503,
        body: {
          status: 'unconfigured',
          mode: 'unconfigured',
          roundTrip: false,
          message: 'Object storage adapter not available',
        },
      };
    }
    let result: Awaited<ReturnType<typeof runStorageHealthProbe>>;
    try {
      result = await runStorageHealthProbe(adapter, {
        roundTrip,
        ...(options.probeTenantId ? { probeTenantId: options.probeTenantId } : {}),
      });
    } catch (error) {
      request.log.error({ err: error }, 'storage health probe threw');
      return {
        statusCode: 503,
        body: {
          status: 'unhealthy',
          mode: 'unhealthy',
          roundTrip,
          message: genericMessage(false, roundTrip),
        },
      };
    }
    if (!result.healthy) {
      request.log.warn(
        { detail: result.detail ?? result.health.message, adapter: result.health.adapter },
        'storage health probe failed',
      );
    }
    return {
      statusCode: result.healthy ? 200 : 503,
      body: {
        status: result.healthy ? 'ok' : 'unhealthy',
        mode: result.healthy ? 'live' : 'unhealthy',
        roundTrip: result.roundTrip,
        message: genericMessage(result.healthy, result.roundTrip),
        adapter: result.health.adapter,
        latencyMs: result.health.latencyMs,
        checkedAt: result.health.checkedAt.toISOString(),
      },
    };
  }
};

export default fp(storageHealthPlugin, {
  name: 'storage-health',
  fastify: '5.x',
});
