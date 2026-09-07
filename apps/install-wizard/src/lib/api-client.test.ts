import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from './api-client';

function mockSessionFetch() {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes('/session')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            csrfToken: 'csrf-test',
            installToken: 'install-test',
          }),
      });
    }
    if (String(url).includes('/status')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            isComplete: false,
            completedSteps: [],
            pendingSteps: ['cdn', 'database', 'storage', 'cache', 'queue'],
            adapterStatuses: {},
          }),
      });
    }
    if (init?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            step: 'database',
            message: 'ok',
            runId: 'run-1',
            completedAt: '2024-01-01T00:00:00Z',
            adapters: {},
          }),
      });
    }
    return Promise.resolve({ ok: false, statusText: 'Not Found' });
  });
}

describe('InstallApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset session tokens via private fields through a fresh module is hard;
    // ensureSession short-circuits once set — re-import pattern avoided by calling ensure via mocks.
    (apiClient as unknown as { csrfToken: string | null }).csrfToken = null;
    (apiClient as unknown as { installToken: string | null }).installToken = null;
  });

  it('boots session then calls getStatus with auth headers', async () => {
    global.fetch = mockSessionFetch();

    const result = await apiClient.getStatus();
    expect(result.isComplete).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/session'),
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/status'),
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({
          'x-csrf-token': 'csrf-test',
          'x-install-token': 'install-test',
        }),
      }),
    );
  });

  it('calls configureDatabase with CSRF and install token', async () => {
    global.fetch = mockSessionFetch();

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
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-csrf-token': 'csrf-test',
          'x-install-token': 'install-test',
        }),
        body: JSON.stringify(config),
      }),
    );
  });

  it('calls configureStorage with auth headers', async () => {
    global.fetch = mockSessionFetch();
    const result = await apiClient.configureStorage({
      adapter: 's3',
      bucket: 'test-bucket',
      region: 'us-east-1',
    });
    expect(result.success).toBe(true);
  });

  it('calls configureCache with auth headers', async () => {
    global.fetch = mockSessionFetch();
    const result = await apiClient.configureCache({
      adapter: 'redis',
      host: 'localhost',
      port: 6379,
    });
    expect(result.success).toBe(true);
  });

  it('calls configureQueue with auth headers', async () => {
    global.fetch = mockSessionFetch();
    const result = await apiClient.configureQueue({
      backend: 'rabbitmq',
      rabbitmq: { url: 'amqp://localhost:5672', exchange: 'proctira' },
    });
    expect(result.success).toBe(true);
  });

  it('calls configureCdn with auth headers', async () => {
    global.fetch = mockSessionFetch();
    const result = await apiClient.configureCdn({
      adapter: 'nginx',
      baseUrl: 'http://localhost:8080',
      tenantAware: true,
    });
    expect(result.success).toBe(true);
  });

  it('calls finalize with auth headers', async () => {
    global.fetch = mockSessionFetch();
    const result = await apiClient.finalize();
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/finalize'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-csrf-token': 'csrf-test',
          'x-install-token': 'install-test',
        }),
      }),
    );
  });

  it('throws on network error for getStatus', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'c', installToken: 'i' }),
        });
      }
      return Promise.resolve({ ok: false, statusText: 'Service Unavailable' });
    });
    (apiClient as unknown as { csrfToken: string | null }).csrfToken = null;
    (apiClient as unknown as { installToken: string | null }).installToken = null;

    await expect(apiClient.getStatus()).rejects.toThrow('Failed to get status');
  });

  it('returns a failed ValidationResult when configure* gets a non-OK response', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'c', installToken: 'i' }),
        });
      }
      return Promise.resolve({
        ok: false,
        statusText: 'Bad Gateway',
        status: 502,
        json: () => Promise.resolve({ error: 'upstream down' }),
      });
    });
    (apiClient as unknown as { csrfToken: string | null }).csrfToken = null;
    (apiClient as unknown as { installToken: string | null }).installToken = null;

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
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ csrfToken: 'c', installToken: 'i' }),
        });
      }
      return Promise.resolve({
        ok: false,
        statusText: 'Conflict',
        status: 409,
        json: () => Promise.resolve({ error: 'already finalized' }),
      });
    });
    (apiClient as unknown as { csrfToken: string | null }).csrfToken = null;
    (apiClient as unknown as { installToken: string | null }).installToken = null;

    const result = await apiClient.finalize();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already finalized|Conflict/i);
  });
});
