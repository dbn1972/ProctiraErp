/**
 * Lifecycle and debounce tests for PluginWatcher (PRC-L486: previously
 * untested SDK area). The debounce cases drive the private change handler
 * directly with fake timers; no real filesystem events are asserted, so the
 * suite cannot depend on watcher timing.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PluginWatcher } from './plugin-watcher.js';

type ChangeHandler = { handleChange(path: string): void };
const trigger = (w: PluginWatcher, path: string) =>
  (w as unknown as ChangeHandler).handleChange(path);

describe('PluginWatcher', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('debounces changes into one onChange call with every path', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const watcher = new PluginWatcher({ watchDir: '.', debounceMs: 50, onChange });
    trigger(watcher, 'a.ts');
    await vi.advanceTimersByTimeAsync(20);
    trigger(watcher, 'b.json');
    await vi.advanceTimersByTimeAsync(49);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['a.ts', 'b.json']);
  });

  it('routes a rejected onChange to onError', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const watcher = new PluginWatcher({
      watchDir: '.',
      debounceMs: 10,
      onChange: async () => {
        throw new Error('reload failed');
      },
      onError,
    });
    trigger(watcher, 'a.ts');
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('reload failed');
  });

  it('stop() cancels a pending debounce', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-watcher-'));
    dirs.push(dir);
    const onChange = vi.fn();
    const watcher = new PluginWatcher({ watchDir: dir, debounceMs: 30, onChange });
    await watcher.start();
    trigger(watcher, 'a.ts');
    await watcher.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('start() sets running, a second start() is a no-op, stop() resets it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-watcher-'));
    dirs.push(dir);
    const watcher = new PluginWatcher({ watchDir: dir, onChange: () => {} });
    expect(watcher.isRunning()).toBe(false);
    await watcher.start();
    expect(watcher.isRunning()).toBe(true);
    await watcher.start();
    expect(watcher.isRunning()).toBe(true);
    await watcher.stop();
    expect(watcher.isRunning()).toBe(false);
    await watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });
});
