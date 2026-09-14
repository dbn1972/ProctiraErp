/**
 * W1-ARCH-07 — graceful shutdown registration + ordered close paths.
 */
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  registerGracefulShutdown,
  resolveShutdownTimeoutMs,
  runShutdownSteps,
} from './graceful-shutdown.js';

describe('resolveShutdownTimeoutMs', () => {
  it('defaults to 15s', () => {
    expect(resolveShutdownTimeoutMs({})).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS);
  });

  it('honours SHUTDOWN_TIMEOUT_MS within bounds', () => {
    expect(resolveShutdownTimeoutMs({ SHUTDOWN_TIMEOUT_MS: '20000' })).toBe(20_000);
    expect(resolveShutdownTimeoutMs({ SHUTDOWN_TIMEOUT_MS: '500' })).toBe(
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
    );
  });
});

describe('runShutdownSteps', () => {
  it('runs steps in order and continues after a mid-step failure', async () => {
    const order: string[] = [];
    await runShutdownSteps(
      [
        {
          name: 'http',
          close: async () => {
            order.push('http');
          },
        },
        {
          name: 'queues',
          close: async () => {
            order.push('queues');
            throw new Error('queue disconnect failed');
          },
        },
        {
          name: 'database',
          close: async () => {
            order.push('database');
          },
        },
      ],
      { timeoutMs: 5_000 },
    );
    expect(order).toEqual(['http', 'queues', 'database']);
  });

  it('times out when a step hangs past the budget', async () => {
    await expect(
      runShutdownSteps(
        [
          {
            name: 'hang',
            close: () => new Promise(() => undefined),
          },
        ],
        { timeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/timed out/i);
  });
});

describe('registerGracefulShutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers SIGINT/SIGTERM and runs close path on signal', async () => {
    const proc = new EventEmitter() as NodeJS.Process;
    const closed: string[] = [];
    const exits: number[] = [];

    const handle = registerGracefulShutdown({
      processRef: proc,
      exit: (code) => {
        exits.push(code);
      },
      timeoutMs: 5_000,
      steps: [
        {
          name: 'http',
          close: async () => {
            closed.push('http');
          },
        },
        {
          name: 'database',
          close: async () => {
            closed.push('database');
          },
        },
      ],
    });

    expect(proc.listenerCount('SIGTERM')).toBe(1);
    expect(proc.listenerCount('SIGINT')).toBe(1);

    proc.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(exits).toEqual([0]);
    });
    expect(closed).toEqual(['http', 'database']);
    expect(handle.shuttingDown).toBe(true);

    handle.unregister();
    expect(proc.listenerCount('SIGTERM')).toBe(0);
  });

  it('forces exit on a second signal while shutting down', async () => {
    const proc = new EventEmitter() as NodeJS.Process;
    const exits: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handle = registerGracefulShutdown({
      processRef: proc,
      exit: (code) => {
        exits.push(code);
      },
      timeoutMs: 10_000,
      steps: [
        {
          name: 'slow',
          close: () => gate,
        },
      ],
    });

    proc.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(handle.shuttingDown).toBe(true);
    });
    proc.emit('SIGINT');
    expect(exits).toEqual([1]);
    release();
    handle.unregister();
  });
});
