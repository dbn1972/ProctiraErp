import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from './api-client';

describe('InstallApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the correct endpoint for getStatus', async () => {
    const mockResponse = {
      isComplete: false,
      completedSteps: [],
      pendingSteps: ['cdn', 'database', 'storage', 'cache', 'queue'],
      adapterStatuses: {},
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await apiClient.getStatus();
    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/status'));
  });

  it('calls configureDatabase with correct payload', async () => {
    const mockResult = { success: true, step: 'database', message: 'Connected', latencyMs: 12 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const config = {
      provider: 'postgresql' as const,
      host: 'localhost',
      port: 5432,
      database: 'proctira',
      username: 'admin',
      password: 'secret',
    };

    const result = await apiClient.configureDatabase(config);
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/configure/database'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      }),
    );
  });

  it('calls configureStorage with correct payload', async () => {
    const mockResult = { success: true, step: 'storage', message: 'Upload test passed', latencyMs: 45 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const config = {
      adapter: 's3' as const,
      bucket: 'test-bucket',
      region: 'us-east-1',
    };

    const result = await apiClient.configureStorage(config);
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/configure/storage'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('calls configureCache with correct payload', async () => {
    const mockResult = { success: true, step: 'cache', message: 'PONG received', latencyMs: 2 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const config = {
      adapter: 'redis' as const,
      host: 'localhost',
      port: 6379,
    };

    const result = await apiClient.configureCache(config);
    expect(result.success).toBe(true);
  });

  it('calls configureQueue with correct payload', async () => {
    const mockResult = { success: true, step: 'queue', message: 'Publish/consume verified', latencyMs: 30 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const config = {
      backend: 'rabbitmq' as const,
      rabbitmq: {
        url: 'amqp://localhost:5672',
        exchange: 'proctira',
      },
    };

    const result = await apiClient.configureQueue(config);
    expect(result.success).toBe(true);
  });

  it('calls configureCdn with correct payload', async () => {
    const mockResult = { success: true, step: 'cdn', message: 'Asset delivery verified', latencyMs: 15 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const config = {
      adapter: 'nginx' as const,
      baseUrl: 'http://localhost:8080',
      tenantAware: true,
    };

    const result = await apiClient.configureCdn(config);
    expect(result.success).toBe(true);
  });

  it('calls finalize endpoint', async () => {
    const mockResult = {
      success: true,
      runId: 'run-123',
      completedAt: '2024-01-01T00:00:00Z',
      adapters: {},
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const result = await apiClient.finalize();
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/finalize'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on network error for getStatus', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Service Unavailable',
    });

    await expect(apiClient.getStatus()).rejects.toThrow('Failed to get status');
  });

  it('returns a failed ValidationResult when configure* gets a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Gateway',
      status: 502,
      json: () => Promise.resolve({ error: 'upstream down' }),
    });

    const result = await apiClient.configureDatabase({
      provider: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'proctira',
      username: 'admin',
      password: 'secret',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/upstream down|Bad Gateway/i);
  });

  it('returns a failed BootstrapResult when finalize gets a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Conflict',
      status: 409,
      json: () => Promise.resolve({ error: 'already finalized' }),
    });

    const result = await apiClient.finalize();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already finalized|Conflict/i);
  });
});
