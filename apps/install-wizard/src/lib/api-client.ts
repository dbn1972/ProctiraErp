/**
 * API client for communicating with the Install/Bootstrap Service.
 *
 * Connects to the Fastify backend install service endpoints.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_INSTALL_API_URL ?? 'http://localhost:3000/install';

export interface ValidationResult {
  success: boolean;
  step: string;
  message: string;
  latencyMs?: number;
  error?: string;
}

export interface BootstrapStatus {
  isComplete: boolean;
  completedSteps: string[];
  pendingSteps: string[];
  adapterStatuses: Record<string, string>;
  lastRunAt?: string;
  lastRunId?: string;
}

export interface BootstrapResult {
  success: boolean;
  runId: string;
  completedAt: string;
  adapters: Record<string, string>;
  error?: string;
}

export interface DatabaseConfig {
  provider: 'postgresql' | 'mysql';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  poolSize?: number;
}

export interface StorageConfig {
  adapter: 's3' | 'minio';
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  useSSL?: boolean;
}

export interface CacheConfig {
  adapter: 'redis' | 'memory';
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: boolean;
  keyPrefix?: string;
}

export interface QueueConfig {
  backend: 'kafka' | 'rabbitmq' | 'sqs';
  kafka?: {
    brokers: string[];
    clientId: string;
    groupId?: string;
    ssl?: boolean;
  };
  rabbitmq?: {
    url: string;
    exchange: string;
    exchangeType?: 'direct' | 'topic' | 'fanout' | 'headers';
  };
  sqs?: {
    region: string;
    queueUrlPrefix: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
  };
}

export interface CdnConfig {
  adapter: 'cloudfront' | 'nginx' | 'custom';
  baseUrl: string;
  tenantAware: boolean;
  brandingPrefix?: string;
  staticPrefix?: string;
  cloudfront?: {
    distributionId: string;
    region?: string;
  };
  custom?: {
    invalidationEndpoint?: string;
    headers?: Record<string, string>;
  };
}

export interface AdminAccountConfig {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantName: string;
  tenantSlug: string;
}

class InstallApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async getStatus(): Promise<BootstrapStatus> {
    const response = await fetch(`${this.baseUrl}/status`);
    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.statusText}`);
    }
    return response.json();
  }

  async configureDatabase(config: DatabaseConfig): Promise<ValidationResult> {
    return this.postConfig('/configure/database', config);
  }

  async configureStorage(config: StorageConfig): Promise<ValidationResult> {
    return this.postConfig('/configure/storage', config);
  }

  async configureCache(config: CacheConfig): Promise<ValidationResult> {
    return this.postConfig('/configure/cache', config);
  }

  async configureQueue(config: QueueConfig): Promise<ValidationResult> {
    return this.postConfig('/configure/queue', config);
  }

  async configureCdn(config: CdnConfig): Promise<ValidationResult> {
    return this.postConfig('/configure/cdn', config);
  }

  async finalize(): Promise<BootstrapResult> {
    const response = await fetch(`${this.baseUrl}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        success: false,
        runId: '',
        completedAt: '',
        adapters: {},
        error: data.error ?? `Finalize failed: ${response.statusText || response.status}`,
      };
    }
    return response.json() as Promise<BootstrapResult>;
  }

  async createAdminAccount(config: AdminAccountConfig): Promise<{ success: boolean; error?: string }> {
    // This endpoint would be part of the finalize flow
    // For now, it's included in the finalize step
    const response = await fetch(`${this.baseUrl}/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { success: false, error: data.error ?? response.statusText };
    }
    return { success: true };
  }

  private async postConfig(path: string, config: unknown): Promise<ValidationResult> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        step?: string;
        message?: string;
        error?: string;
      };
      return {
        success: false,
        step: data.step ?? path,
        message: data.message ?? data.error ?? `Request failed: ${response.statusText || response.status}`,
        error: data.error ?? response.statusText,
      };
    }
    return response.json() as Promise<ValidationResult>;
  }
}

export const apiClient = new InstallApiClient();
