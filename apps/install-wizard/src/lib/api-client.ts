/**
 * API client for the Install Wizard BFF (`/api/install/*`).
 *
 * Issues a CSRF + install-token session, then sends both on mutate calls.
 * Optional NEXT_PUBLIC_INSTALL_API_URL overrides the base (still expects same contract).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_INSTALL_API_URL ?? '/api/install';

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
  private csrfToken: string | null = null;
  private installToken: string | null = null;
  private sessionPromise: Promise<void> | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /** Ensure CSRF + install-token session is established (idempotent). */
  async ensureSession(): Promise<void> {
    if (this.csrfToken && this.installToken) return;
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const response = await fetch(`${this.baseUrl}/session`, {
          method: 'GET',
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(`Failed to start install session: ${response.statusText}`);
        }
        const data = (await response.json()) as {
          csrfToken?: string;
          installToken?: string;
        };
        if (!data.csrfToken || !data.installToken) {
          throw new Error('Install session response missing tokens.');
        }
        this.csrfToken = data.csrfToken;
        this.installToken = data.installToken;
      })().finally(() => {
        this.sessionPromise = null;
      });
    }
    await this.sessionPromise;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.csrfToken) headers['x-csrf-token'] = this.csrfToken;
    if (this.installToken) headers['x-install-token'] = this.installToken;
    return headers;
  }

  async getStatus(): Promise<BootstrapStatus> {
    await this.ensureSession();
    const response = await fetch(`${this.baseUrl}/status`, {
      credentials: 'include',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to get status: ${response.statusText}`);
    }
    return (await response.json()) as BootstrapStatus;
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
    await this.ensureSession();
    const response = await fetch(`${this.baseUrl}/finalize`, {
      method: 'POST',
      credentials: 'include',
      headers: this.authHeaders(),
      body: JSON.stringify({}),
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

  async createAdminAccount(
    config: AdminAccountConfig,
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureSession();
    const response = await fetch(`${this.baseUrl}/admin`, {
      method: 'POST',
      credentials: 'include',
      headers: this.authHeaders(),
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return { success: false, error: data.error ?? response.statusText };
    }
    return { success: true };
  }

  private async postConfig(path: string, config: unknown): Promise<ValidationResult> {
    await this.ensureSession();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: this.authHeaders(),
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
        message:
          data.message ?? data.error ?? `Request failed: ${response.statusText || response.status}`,
        error: data.error ?? response.statusText,
      };
    }
    return response.json() as Promise<ValidationResult>;
  }
}

export const apiClient = new InstallApiClient();
