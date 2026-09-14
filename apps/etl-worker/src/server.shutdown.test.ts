/**
 * W1-ARCH-07 — ETL worker registers ordered graceful shutdown handlers.
 */
import { EventEmitter } from 'node:events';

import { InMemoryPipelineRepository } from '@proctira/backend-etl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildEtlWorkerApp, installEtlWorkerShutdown } from './server.js';

describe('etl-worker graceful shutdown (W1-ARCH-07)', () => {
  const prevLog = process.env.LOG_LEVEL;

  afterEach(() => {
    if (prevLog === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = prevLog;
  });

  it('registers SIGINT/SIGTERM and runs HTTP close on signal', async () => {
    process.env.LOG_LEVEL = 'silent';
    const app = await buildEtlWorkerApp({
      repository: new InMemoryPipelineRepository(),
    });
    const closeSpy = vi.spyOn(app, 'close');
    const proc = new EventEmitter() as NodeJS.Process;
    const exits: number[] = [];

    const handle = installEtlWorkerShutdown(app, {
      processRef: proc,
      exit: (code) => {
        exits.push(code);
      },
    });

    expect(proc.listenerCount('SIGTERM')).toBe(1);
    expect(proc.listenerCount('SIGINT')).toBe(1);

    proc.emit('SIGTERM');
    await vi.waitFor(() => {
      expect(exits).toEqual([0]);
    });
    expect(closeSpy).toHaveBeenCalled();
    expect(handle.shuttingDown).toBe(true);
    handle.unregister();
  });
});
