/**
 * Unit tests for InstallServiceImpl - Bootstrap configuration flow.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InstallServiceImpl } from './install-service';
import type { ConnectivityTester } from './install-service';
import { InMemoryBootstrapStore } from './bootstrap-store';
import { createLogger } from '@proctira/logging';
import type {
  CdnConfigInput,
  DatabaseConfigInput,
  StorageConfigInput,
  CacheConfigInput,
  QueueConfigInput,
} from './types';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function createTestLogger() {
  return createLogger({ name: 'install-test', level: 'silent' });
}

function validCdnConfig(): CdnConfigInput {
  return {
    adapter: 'nginx',
    baseUrl: 'https://cdn.example.com',
    tenantAware: true,
  };
}

function validDatabaseConfig(): DatabaseConfigInput {
  return {
    provider: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'proctira',
    username: 'admin',
    password: 'secret',
  };
}

function validStorageConfig(): StorageConfigInput {
  return {
    adapter: 'minio',
    bucket: 'proctira-files',
    endpoint: 'http://localhost:9000',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  };
}

function validCacheConfig(): CacheConfigInput {
  return {
    adapter: 'redis',
    host: 'localhost',
    port: 6379,
  };
}

function validQueueConfig(): QueueConfigInput {
  return {
    backend: 'rabbitmq',
    rabbitmq: {
      url: 'amqp://localhost:5672',
      exchange: 'proctira',
    },
  };
}

function createHealthyConnectivityTester(): ConnectivityTester {
  return {
    testCdn: async () => ({ healthy: true, latencyMs: 5 }),
    testDatabase: async () => ({ healthy: true, latencyMs: 10 }),
    testStorage: async () => ({ healthy: true, latencyMs: 8 }),
    testCache: async () => ({ healthy: true, latencyMs: 2 }),
    testQueue: async () => ({ healthy: true, latencyMs: 12 }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InstallServiceImpl', () => {
  let service: InstallServiceImpl;
  let store: InMemoryBootstrapStore;

  beforeEach(() => {
    store = new InMemoryBootstrapStore();
    service = new InstallServiceImpl({
      logger: createTestLogger(),
      store,
      connectivityTester: createHealthyConnectivityTester(),
    });
  });

  describe('getBootstrapStatus', () => {
    it('should return all steps as pending initially', async () => {
      const status = await service.getBootstrapStatus();

      expect(status.isComplete).toBe(false);
      expect(status.completedSteps).toEqual([]);
      expect(status.pendingSteps).toEqual(['cdn', 'database', 'storage', 'cache', 'queue']);
      expect(status.adapterStatuses.cdn).toBe('pending');
      expect(status.adapterStatuses.database).toBe('pending');
      expect(status.adapterStatuses.storage).toBe('pending');
      expect(status.adapterStatuses.cache).toBe('pending');
      expect(status.adapterStatuses.queue).toBe('pending');
    });

    it('should reflect completed steps', async () => {
      await service.configureCDN(validCdnConfig());

      const status = await service.getBootstrapStatus();

      expect(status.isComplete).toBe(false);
      expect(status.completedSteps).toEqual(['cdn']);
      expect(status.pendingSteps).toEqual(['database', 'storage', 'cache', 'queue']);
      expect(status.adapterStatuses.cdn).toBe('configured');
    });

    it('should return isComplete=true after full bootstrap', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());
      await service.configureQueue(validQueueConfig());
      await service.finalizeBootstrap();

      const status = await service.getBootstrapStatus();

      expect(status.isComplete).toBe(true);
      expect(status.completedSteps).toEqual(['cdn', 'database', 'storage', 'cache', 'queue']);
      expect(status.pendingSteps).toEqual([]);
    });
  });

  describe('configureCDN', () => {
    it('should succeed with valid configuration', async () => {
      const result = await service.configureCDN(validCdnConfig());

      expect(result.success).toBe(true);
      expect(result.step).toBe('cdn');
      expect(result.latencyMs).toBeDefined();
    });

    it('should fail with empty baseUrl', async () => {
      const config = { ...validCdnConfig(), baseUrl: '' };
      const result = await service.configureCDN(config);

      expect(result.success).toBe(false);
      expect(result.step).toBe('cdn');
      expect(result.error).toBeDefined();
    });

    it('should fail with invalid URL format', async () => {
      const config = { ...validCdnConfig(), baseUrl: 'not-a-url' };
      const result = await service.configureCDN(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should fail when cloudfront adapter lacks distributionId', async () => {
      const config: CdnConfigInput = {
        adapter: 'cloudfront',
        baseUrl: 'https://cdn.example.com',
        tenantAware: true,
      };
      const result = await service.configureCDN(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('distributionId');
    });

    it('should fail when connectivity test fails', async () => {
      const failingService = new InstallServiceImpl({
        logger: createTestLogger(),
        store,
        connectivityTester: {
          testCdn: async () => ({ healthy: false, latencyMs: 100, error: 'Connection refused' }),
        },
      });

      const result = await failingService.configureCDN(validCdnConfig());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('configureDatabase', () => {
    it('should succeed with valid configuration after CDN', async () => {
      await service.configureCDN(validCdnConfig());
      const result = await service.configureDatabase(validDatabaseConfig());

      expect(result.success).toBe(true);
      expect(result.step).toBe('database');
    });

    it('should fail if CDN step is not completed first', async () => {
      const result = await service.configureDatabase(validDatabaseConfig());

      expect(result.success).toBe(false);
      expect(result.error).toContain('cdn');
    });

    it('should fail with invalid port', async () => {
      await service.configureCDN(validCdnConfig());
      const config = { ...validDatabaseConfig(), port: 99999 };
      const result = await service.configureDatabase(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('port');
    });
  });

  describe('configureStorage', () => {
    it('should succeed with valid configuration after CDN and Database', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      const result = await service.configureStorage(validStorageConfig());

      expect(result.success).toBe(true);
      expect(result.step).toBe('storage');
    });

    it('should fail if prerequisite steps are not completed', async () => {
      await service.configureCDN(validCdnConfig());
      // Skip database
      const result = await service.configureStorage(validStorageConfig());

      expect(result.success).toBe(false);
      expect(result.error).toContain('database');
    });

    it('should fail for MinIO without endpoint', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());

      const config: StorageConfigInput = {
        adapter: 'minio',
        bucket: 'test',
      };
      const result = await service.configureStorage(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('endpoint');
    });

    it('should fail for S3 without region', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());

      const config: StorageConfigInput = {
        adapter: 's3',
        bucket: 'test',
      };
      const result = await service.configureStorage(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('region');
    });
  });

  describe('configureCache', () => {
    it('should succeed with valid Redis configuration', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      const result = await service.configureCache(validCacheConfig());

      expect(result.success).toBe(true);
      expect(result.step).toBe('cache');
    });

    it('should succeed with memory adapter (no host required)', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());

      const config: CacheConfigInput = { adapter: 'memory' };
      const result = await service.configureCache(config);

      expect(result.success).toBe(true);
    });

    it('should fail for Redis without host', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());

      const config: CacheConfigInput = { adapter: 'redis' };
      const result = await service.configureCache(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('host');
    });
  });

  describe('configureQueue', () => {
    it('should succeed with valid RabbitMQ configuration', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());
      const result = await service.configureQueue(validQueueConfig());

      expect(result.success).toBe(true);
      expect(result.step).toBe('queue');
    });

    it('should succeed with valid Kafka configuration', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());

      const config: QueueConfigInput = {
        backend: 'kafka',
        kafka: {
          brokers: ['localhost:9092'],
          clientId: 'proctira',
        },
      };
      const result = await service.configureQueue(config);

      expect(result.success).toBe(true);
    });

    it('should succeed with valid SQS configuration', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());

      const config: QueueConfigInput = {
        backend: 'sqs',
        sqs: {
          region: 'us-east-1',
          queueUrlPrefix: 'https://sqs.us-east-1.amazonaws.com/123456789/proctira',
        },
      };
      const result = await service.configureQueue(config);

      expect(result.success).toBe(true);
    });

    it('should fail for Kafka without brokers', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());

      const config: QueueConfigInput = {
        backend: 'kafka',
        kafka: {
          brokers: [],
          clientId: 'proctira',
        },
      };
      const result = await service.configureQueue(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('broker');
    });

    it('should fail for RabbitMQ without url', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());

      const config: QueueConfigInput = {
        backend: 'rabbitmq',
        rabbitmq: {
          url: '',
          exchange: 'test',
        },
      };
      const result = await service.configureQueue(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('url');
    });
  });

  describe('finalizeBootstrap', () => {
    it('should succeed when all steps are completed', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());
      await service.configureQueue(validQueueConfig());

      const result = await service.finalizeBootstrap();

      expect(result.success).toBe(true);
      expect(result.runId).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(result.adapters.cdn).toBe('configured');
      expect(result.adapters.database).toBe('configured');
      expect(result.adapters.storage).toBe('configured');
      expect(result.adapters.cache).toBe('configured');
      expect(result.adapters.queue).toBe('configured');
    });

    it('should fail when steps are missing (all-or-nothing)', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      // Skip storage, cache, queue

      const result = await service.finalizeBootstrap();

      expect(result.success).toBe(false);
      expect(result.error).toContain('storage');
      expect(result.error).toContain('cache');
      expect(result.error).toContain('queue');
    });

    it('should persist the completed run to the store', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());
      await service.configureQueue(validQueueConfig());
      await service.finalizeBootstrap();

      const latestRun = await store.getLatestRun();
      expect(latestRun).not.toBeNull();
      expect(latestRun!.status).toBe('completed');
      expect(latestRun!.completedSteps).toEqual(['cdn', 'database', 'storage', 'cache', 'queue']);
    });

    it('should lock configure and finalize after successful bootstrap', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());
      await service.configureQueue(validQueueConfig());
      const first = await service.finalizeBootstrap();
      expect(first.success).toBe(true);

      const lockedConfigure = await service.configureCDN(validCdnConfig());
      expect(lockedConfigure.success).toBe(false);
      expect(lockedConfigure.error).toMatch(/already finalized|locked/i);

      const lockedFinalize = await service.finalizeBootstrap();
      expect(lockedFinalize.success).toBe(false);
      expect(lockedFinalize.error).toMatch(/already finalized|locked/i);
    });
  });

  describe('getAdapterHealth', () => {
    it('should report all adapters as not configured initially', async () => {
      const health = await service.getAdapterHealth();

      expect(health.status).toBe('unhealthy');
      expect(health.adapters['cdn']!.healthy).toBe(false);
      expect(health.adapters['cdn']!.message).toBe('Not configured');
    });

    it('should report healthy adapters after configuration', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      await service.configureCache(validCacheConfig());
      await service.configureQueue(validQueueConfig());

      const health = await service.getAdapterHealth();

      expect(health.status).toBe('healthy');
      expect(health.adapters['cdn']!.healthy).toBe(true);
      expect(health.adapters['database']!.healthy).toBe(true);
      expect(health.adapters['storage']!.healthy).toBe(true);
      expect(health.adapters['cache']!.healthy).toBe(true);
      expect(health.adapters['queue']!.healthy).toBe(true);
    });

    it('should report degraded when some adapters are unhealthy', async () => {
      const mixedTester: ConnectivityTester = {
        testCdn: async () => ({ healthy: true, latencyMs: 5 }),
        testDatabase: async () => ({ healthy: false, latencyMs: 0, error: 'Connection refused' }),
        testStorage: async () => ({ healthy: true, latencyMs: 8 }),
        testCache: async () => ({ healthy: true, latencyMs: 2 }),
        testQueue: async () => ({ healthy: true, latencyMs: 12 }),
      };

      const mixedService = new InstallServiceImpl({
        logger: createTestLogger(),
        store: new InMemoryBootstrapStore(),
        connectivityTester: mixedTester,
      });

      await mixedService.configureCDN(validCdnConfig());
      await mixedService.configureDatabase(validDatabaseConfig());
      await mixedService.configureStorage(validStorageConfig());
      await mixedService.configureCache(validCacheConfig());
      await mixedService.configureQueue(validQueueConfig());

      const health = await mixedService.getAdapterHealth();

      expect(health.status).toBe('degraded');
      expect(health.adapters['cdn']!.healthy).toBe(true);
      expect(health.adapters['database']!.healthy).toBe(false);
    });
  });

  describe('step ordering enforcement', () => {
    it('should prevent configuring database before CDN', async () => {
      const result = await service.configureDatabase(validDatabaseConfig());
      expect(result.success).toBe(false);
      expect(result.error).toContain('cdn');
    });

    it('should prevent configuring storage before database', async () => {
      await service.configureCDN(validCdnConfig());
      const result = await service.configureStorage(validStorageConfig());
      expect(result.success).toBe(false);
      expect(result.error).toContain('database');
    });

    it('should prevent configuring cache before storage', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      const result = await service.configureCache(validCacheConfig());
      expect(result.success).toBe(false);
      expect(result.error).toContain('storage');
    });

    it('should prevent configuring queue before cache', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());
      await service.configureStorage(validStorageConfig());
      const result = await service.configureQueue(validQueueConfig());
      expect(result.success).toBe(false);
      expect(result.error).toContain('cache');
    });
  });

  describe('bootstrap run persistence', () => {
    it('should create a run record on first configuration step', async () => {
      await service.configureCDN(validCdnConfig());

      const run = await store.getLatestRun();
      expect(run).not.toBeNull();
      expect(run!.status).toBe('in_progress');
      expect(run!.completedSteps).toContain('cdn');
    });

    it('should update the run record as steps complete', async () => {
      await service.configureCDN(validCdnConfig());
      await service.configureDatabase(validDatabaseConfig());

      const run = await store.getLatestRun();
      expect(run!.completedSteps).toEqual(['cdn', 'database']);
    });

    it('should mark run as failed when finalize fails', async () => {
      await service.configureCDN(validCdnConfig());
      await service.finalizeBootstrap();

      const run = await store.getLatestRun();
      expect(run!.status).toBe('failed');
      expect(run!.error).toContain('missing steps');
    });
  });
});
