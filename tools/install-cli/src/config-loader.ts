/**
 * Configuration Loader - Reads install configuration from multiple sources.
 *
 * Supports three configuration modes:
 * 1. JSON file (--config path/to/config.json)
 * 2. Environment variables (--env)
 * 3. Interactive prompts (--interactive or default)
 *
 * Priority: CLI flags > JSON file > environment variables > defaults
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { InstallConfig, AdminAccountConfig } from './types';
import { ENV_VAR_MAP } from './types';
import type {
  CdnConfigInput,
  DatabaseConfigInput,
  StorageConfigInput,
  CacheConfigInput,
  QueueConfigInput,
} from '@proctira/backend-install';

/**
 * Loads configuration from a JSON file.
 * Validates that the file exists and is valid JSON.
 */
export function loadConfigFromFile(filePath: string): InstallConfig {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');

  try {
    const config = JSON.parse(content) as InstallConfig;
    validateConfigStructure(config);
    return config;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Loads configuration from environment variables.
 * Uses the ENV_VAR_MAP to map env vars to config paths.
 */
export function loadConfigFromEnv(env: Record<string, string | undefined> = process.env): InstallConfig {
  const config: InstallConfig = {
    cdn: {
      adapter: (env['OPENEMIS_CDN_ADAPTER'] as CdnConfigInput['adapter']) ?? 'nginx',
      baseUrl: env['OPENEMIS_CDN_BASE_URL'] ?? '',
      tenantAware: env['OPENEMIS_CDN_TENANT_AWARE'] !== 'false',
      cloudfront: env['OPENEMIS_CDN_CLOUDFRONT_DISTRIBUTION_ID']
        ? {
            distributionId: env['OPENEMIS_CDN_CLOUDFRONT_DISTRIBUTION_ID'],
            region: env['OPENEMIS_CDN_CLOUDFRONT_REGION'],
          }
        : undefined,
    },
    database: {
      provider: (env['OPENEMIS_DB_PROVIDER'] as DatabaseConfigInput['provider']) ?? 'postgresql',
      host: env['OPENEMIS_DB_HOST'] ?? 'localhost',
      port: parseInt(env['OPENEMIS_DB_PORT'] ?? '5432', 10),
      database: env['OPENEMIS_DB_NAME'] ?? 'proctira',
      username: env['OPENEMIS_DB_USERNAME'] ?? '',
      password: env['OPENEMIS_DB_PASSWORD'] ?? '',
      ssl: env['OPENEMIS_DB_SSL'] === 'true',
      poolSize: env['OPENEMIS_DB_POOL_SIZE'] ? parseInt(env['OPENEMIS_DB_POOL_SIZE'], 10) : undefined,
    },
    storage: {
      adapter: (env['OPENEMIS_STORAGE_ADAPTER'] as StorageConfigInput['adapter']) ?? 'minio',
      bucket: env['OPENEMIS_STORAGE_BUCKET'] ?? 'proctira',
      region: env['OPENEMIS_STORAGE_REGION'],
      endpoint: env['OPENEMIS_STORAGE_ENDPOINT'],
      accessKeyId: env['OPENEMIS_STORAGE_ACCESS_KEY'],
      secretAccessKey: env['OPENEMIS_STORAGE_SECRET_KEY'],
      forcePathStyle: env['OPENEMIS_STORAGE_FORCE_PATH_STYLE'] === 'true',
    },
    cache: {
      adapter: (env['OPENEMIS_CACHE_ADAPTER'] as CacheConfigInput['adapter']) ?? 'redis',
      host: env['OPENEMIS_CACHE_HOST'] ?? 'localhost',
      port: env['OPENEMIS_CACHE_PORT'] ? parseInt(env['OPENEMIS_CACHE_PORT'], 10) : 6379,
      password: env['OPENEMIS_CACHE_PASSWORD'],
      db: env['OPENEMIS_CACHE_DB'] ? parseInt(env['OPENEMIS_CACHE_DB'], 10) : 0,
      tls: env['OPENEMIS_CACHE_TLS'] === 'true',
      keyPrefix: env['OPENEMIS_CACHE_KEY_PREFIX'] ?? 'proctira:',
    },
    queue: {
      backend: (env['OPENEMIS_QUEUE_BACKEND'] as QueueConfigInput['backend']) ?? 'rabbitmq',
      kafka: env['OPENEMIS_QUEUE_KAFKA_BROKERS']
        ? {
            brokers: env['OPENEMIS_QUEUE_KAFKA_BROKERS'].split(','),
            clientId: env['OPENEMIS_QUEUE_KAFKA_CLIENT_ID'] ?? 'proctira',
            groupId: env['OPENEMIS_QUEUE_KAFKA_GROUP_ID'],
          }
        : undefined,
      rabbitmq: env['OPENEMIS_QUEUE_RABBITMQ_URL']
        ? {
            url: env['OPENEMIS_QUEUE_RABBITMQ_URL'],
            exchange: env['OPENEMIS_QUEUE_RABBITMQ_EXCHANGE'] ?? 'proctira',
          }
        : undefined,
      sqs: env['OPENEMIS_QUEUE_SQS_REGION']
        ? {
            region: env['OPENEMIS_QUEUE_SQS_REGION'],
            queueUrlPrefix: env['OPENEMIS_QUEUE_SQS_QUEUE_URL_PREFIX'] ?? '',
          }
        : undefined,
    },
    admin: {
      username: env['OPENEMIS_ADMIN_USERNAME'] ?? 'admin@proctira.org',
      password: env['OPENEMIS_ADMIN_PASSWORD'] ?? '',
      firstName: env['OPENEMIS_ADMIN_FIRST_NAME'] ?? 'System',
      lastName: env['OPENEMIS_ADMIN_LAST_NAME'] ?? 'Administrator',
    },
  };

  return config;
}

/**
 * Loads configuration via interactive prompts.
 * Asks the user for each configuration value with defaults.
 */
export async function loadConfigInteractive(
  rl?: readline.Interface,
): Promise<InstallConfig> {
  const reader = rl ?? readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string, defaultValue?: string): Promise<string> => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    return new Promise((resolve) => {
      reader.question(prompt, (answer) => {
        resolve(answer.trim() || defaultValue || '');
      });
    });
  };

  const askPassword = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      reader.question(`${question}: `, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  try {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║     ProctiraERP Unified Platform - Installation     ║');
    console.log('╚══════════════════════════════════════════════════╝\n');

    // CDN Configuration
    console.log('── CDN Configuration ──────────────────────────────');
    const cdnAdapter = await ask('CDN adapter (cloudfront/nginx/custom)', 'nginx') as CdnConfigInput['adapter'];
    const cdnBaseUrl = await ask('CDN base URL', 'http://localhost:8080');
    const cdnTenantAware = (await ask('Tenant-aware CDN? (true/false)', 'true')) === 'true';

    let cloudfront: CdnConfigInput['cloudfront'] | undefined;
    if (cdnAdapter === 'cloudfront') {
      const distId = await ask('CloudFront distribution ID');
      const region = await ask('CloudFront region', 'us-east-1');
      cloudfront = { distributionId: distId, region };
    }

    // Database Configuration
    console.log('\n── Database Configuration ─────────────────────────');
    const dbProvider = await ask('Database provider (postgresql/mysql)', 'postgresql') as DatabaseConfigInput['provider'];
    const dbHost = await ask('Database host', 'localhost');
    const dbPort = parseInt(await ask('Database port', dbProvider === 'postgresql' ? '5432' : '3306'), 10);
    const dbName = await ask('Database name', 'proctira');
    const dbUsername = await ask('Database username', 'proctira');
    const dbPassword = await askPassword('Database password');
    const dbSsl = (await ask('Use SSL? (true/false)', 'false')) === 'true';

    // Storage Configuration
    console.log('\n── Object Storage Configuration ───────────────────');
    const storageAdapter = await ask('Storage adapter (s3/minio)', 'minio') as StorageConfigInput['adapter'];
    const storageBucket = await ask('Storage bucket', 'proctira');
    const storageRegion = storageAdapter === 's3' ? await ask('AWS region', 'us-east-1') : undefined;
    const storageEndpoint = storageAdapter === 'minio' ? await ask('MinIO endpoint', 'http://localhost:9000') : undefined;
    const storageAccessKey = await ask('Access key ID');
    const storageSecretKey = await askPassword('Secret access key');

    // Cache Configuration
    console.log('\n── Cache Configuration ────────────────────────────');
    const cacheAdapter = await ask('Cache adapter (redis/memory)', 'redis') as CacheConfigInput['adapter'];
    let cacheHost: string | undefined;
    let cachePort: number | undefined;
    let cachePassword: string | undefined;
    if (cacheAdapter === 'redis') {
      cacheHost = await ask('Redis host', 'localhost');
      cachePort = parseInt(await ask('Redis port', '6379'), 10);
      cachePassword = await askPassword('Redis password (leave empty for none)') || undefined;
    }

    // Queue Configuration
    console.log('\n── Queue Configuration ────────────────────────────');
    const queueBackend = await ask('Queue backend (kafka/rabbitmq/sqs)', 'rabbitmq') as QueueConfigInput['backend'];

    let kafka: QueueConfigInput['kafka'] | undefined;
    let rabbitmq: QueueConfigInput['rabbitmq'] | undefined;
    let sqs: QueueConfigInput['sqs'] | undefined;

    if (queueBackend === 'kafka') {
      const brokers = await ask('Kafka brokers (comma-separated)', 'localhost:9092');
      const clientId = await ask('Kafka client ID', 'proctira');
      kafka = { brokers: brokers.split(','), clientId };
    } else if (queueBackend === 'rabbitmq') {
      const url = await ask('RabbitMQ URL', 'amqp://localhost:5672');
      const exchange = await ask('RabbitMQ exchange', 'proctira');
      rabbitmq = { url, exchange };
    } else if (queueBackend === 'sqs') {
      const region = await ask('SQS region', 'us-east-1');
      const queueUrlPrefix = await ask('SQS queue URL prefix');
      sqs = { region, queueUrlPrefix };
    }

    // Admin Account
    console.log('\n── Admin Account ──────────────────────────────────');
    const adminUsername = await ask('Admin email', 'admin@proctira.org');
    const adminPassword = await askPassword('Admin password (min 8 characters)');
    const adminFirstName = await ask('Admin first name', 'System');
    const adminLastName = await ask('Admin last name', 'Administrator');

    const config: InstallConfig = {
      cdn: {
        adapter: cdnAdapter,
        baseUrl: cdnBaseUrl,
        tenantAware: cdnTenantAware,
        cloudfront,
      },
      database: {
        provider: dbProvider,
        host: dbHost,
        port: dbPort,
        database: dbName,
        username: dbUsername,
        password: dbPassword,
        ssl: dbSsl,
      },
      storage: {
        adapter: storageAdapter,
        bucket: storageBucket,
        region: storageRegion,
        endpoint: storageEndpoint,
        accessKeyId: storageAccessKey,
        secretAccessKey: storageSecretKey,
      },
      cache: {
        adapter: cacheAdapter,
        host: cacheHost,
        port: cachePort,
        password: cachePassword,
      },
      queue: {
        backend: queueBackend,
        kafka,
        rabbitmq,
        sqs,
      },
      admin: {
        username: adminUsername,
        password: adminPassword,
        firstName: adminFirstName,
        lastName: adminLastName,
      },
    };

    return config;
  } finally {
    if (!rl) {
      reader.close();
    }
  }
}

/**
 * Validates the basic structure of a configuration object.
 * Throws if required top-level sections are missing.
 */
export function validateConfigStructure(config: unknown): asserts config is InstallConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Configuration must be a non-null object');
  }

  const obj = config as Record<string, unknown>;
  const requiredSections = ['cdn', 'database', 'storage', 'cache', 'queue', 'admin'];
  const missingSections = requiredSections.filter((s) => !obj[s] || typeof obj[s] !== 'object');

  if (missingSections.length > 0) {
    throw new Error(
      `Configuration is missing required sections: ${missingSections.join(', ')}`,
    );
  }

  // Validate admin account fields
  const admin = obj['admin'] as Record<string, unknown>;
  if (!admin['username'] || typeof admin['username'] !== 'string') {
    throw new Error('admin.username is required and must be a string');
  }
  if (!admin['password'] || typeof admin['password'] !== 'string') {
    throw new Error('admin.password is required and must be a string');
  }
  if (admin['password'].length < 8) {
    throw new Error('admin.password must be at least 8 characters');
  }
  if (!admin['firstName'] || typeof admin['firstName'] !== 'string') {
    throw new Error('admin.firstName is required and must be a string');
  }
  if (!admin['lastName'] || typeof admin['lastName'] !== 'string') {
    throw new Error('admin.lastName is required and must be a string');
  }
}
