/**
 * PRC-L397: the standalone workflow server registers graceful shutdown before
 * it starts listening, so a SIGTERM during or right after listen is handled.
 */
import { describe, expect, it, vi } from 'vitest';
// Loaded at collection so the import cost of the workflow module graph is not
// bounded by the 5 s test timeout (PRC-L397 CI flake); the vi.mock / vi.hoisted
// blocks below are hoisted above this import, so the mocks and PORT still apply.
import './standalone-server.js';

const calls = vi.hoisted(() => {
  process.env['PORT'] = '0';
  return [] as string[];
});

vi.mock('@proctira/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/common')>();
  return {
    ...actual,
    registerGracefulShutdown: vi.fn(() => {
      calls.push('registerGracefulShutdown');
    }),
  };
});

vi.mock('@proctira/database', () => ({
  closeDatabaseResources: vi.fn(async () => undefined),
}));

vi.mock('@proctira/observability', () => ({
  observabilityPlugin: vi.fn(),
}));

vi.mock('fastify', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = {
    log,
    register: vi.fn(async () => undefined),
    get: vi.fn(),
    close: vi.fn(async () => undefined),
    listen: vi.fn(async () => {
      calls.push('listen');
      return 'http://127.0.0.1:0';
    }),
  };
  return { default: vi.fn(() => app) };
});

describe('workflow standalone server startup (PRC-L397)', () => {
  it('registers graceful shutdown before app.listen', async () => {
    await vi.waitFor(() => {
      expect(calls).toContain('listen');
    });
    expect(calls).toEqual(['registerGracefulShutdown', 'listen']);
  });
});
