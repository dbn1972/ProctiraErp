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

    // Poll for the rejection's `.catch` handler to run rather than assuming
    // a fixed number of microtask ticks is enough: under CI load the event
    // loop can take longer than two zero-delay `setTimeout`s to get back to
    // this chain, which previously made this test flaky (timed out at the
    // outer 5000ms test timeout despite the assertion being correct).
    await vi.waitFor(
      () => {
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
      { timeout: 4000, interval: 10 },
    );

    expect(errorSpy).toHaveBeenCalled();
  });

  it('exports start() directly so it can be invoked and awaited without relying on module side effects', async () => {
    const { start } = await import('./standalone-server.js');
    await expect(start()).rejects.toThrow('PRC-L572 simulated observability registration failure');
  });
});
