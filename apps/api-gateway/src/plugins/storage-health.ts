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
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

export interface StorageHealthOptions {
  /** Override adapter (tests). When omitted, built from env. */
  adapter?: StorageAdapter | null;
  /** Skip put/get/delete when false (healthCheck only). Default true. */
  roundTrip?: boolean;
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
}> {
  const health = await adapter.healthCheck();
  if (!health.healthy) {
    return {
      healthy: false,
      roundTrip: false,
      health,
      message: health.message,
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
      message: `Object storage round-trip failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const storageHealthPlugin: FastifyPluginAsync<StorageHealthOptions> = async (
  fastify: FastifyInstance,
  options: StorageHealthOptions,
) => {
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
    async (_request, reply) => {
      let adapter = options.adapter;
      if (adapter === undefined) {
        const envConfig = readStorageEnv();
        const adapterConfig = buildStorageAdapterConfig(envConfig);
        if (!adapterConfig) {
          return reply.status(503).send({
            status: 'unconfigured',
            mode: 'unconfigured',
            roundTrip: false,
            message:
              'Object storage not configured (set S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY; optional S3_ENDPOINT for MinIO)',
          });
        }
        adapter = createStorageAdapter(adapterConfig);
      }

      if (adapter === null) {
        return reply.status(503).send({
          status: 'unconfigured',
          mode: 'unconfigured',
          roundTrip: false,
          message: 'Object storage adapter not available',
        });
      }

      const result = await runStorageHealthProbe(adapter, {
        roundTrip: options.roundTrip,
        probeTenantId: options.probeTenantId,
      });

      const body = {
        status: result.healthy ? 'ok' : 'unhealthy',
        mode: result.healthy ? 'live' : 'unhealthy',
        roundTrip: result.roundTrip,
        message: result.message,
        adapter: result.health.adapter,
        latencyMs: result.health.latencyMs,
        checkedAt: result.health.checkedAt.toISOString(),
      };

      if (!result.healthy) {
        return reply.status(503).send(body);
      }
      return reply.status(200).send(body);
    },
  );
};

export default fp(storageHealthPlugin, {
  name: 'storage-health',
  fastify: '4.x',
});
