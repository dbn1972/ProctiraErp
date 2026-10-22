/**
 * PRC-L572 — the module-level `start()` call must fail loudly (log + nonzero
 * `process.exit`) instead of leaving an unhandled promise rejection when
 * `start()` rejects before the server starts listening.
 *
 * `observabilityPlugin` is mocked to reject so the failure happens before
 * `app.listen` is ever reached — no real network listener is created by this
 * test. Importing the module (at the bottom of this file, indirectly via
 * dynamic `import()`) triggers its module-level `start().catch(...)` chain;
 * we then wait a tick for that chain to settle and assert `process.exit`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@proctira/observability', () => ({
  observabilityPlugin: async () => {
    throw new Error('PRC-L572 simulated observability registration failure');
  },
}));

describe('PRC-L572 standalone-server start() rejection handling', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('calls process.exit(1) when start() rejects, instead of an unhandled rejection', async () => {
    // Importing the module runs its module-level `start().catch(...)` call.
    await import('./standalone-server.js');

    // Flush the microtask queue so the rejected promise's `.catch` handler runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exports start() directly so it can be invoked and awaited without relying on module side effects', async () => {
    const { start } = await import('./standalone-server.js');
    await expect(start()).rejects.toThrow('PRC-L572 simulated observability registration failure');
  });
});
