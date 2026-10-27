/**
 * Lifecycle tests for DevServer (PRC-L486: previously untested SDK area).
 *
 * Plugin loading itself is a stub tracked separately (PRC-M605), so these
 * tests cover start/stop state only and do not pin getPlugin() behaviour.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevServer } from './dev-server.js';

describe('DevServer lifecycle', () => {
  const dirs: string[] = [];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('start() and stop() toggle isRunning() without hot reload', async () => {
    const server = new DevServer({ hotReload: false });
    expect(server.isRunning()).toBe(false);
    await server.start();
    expect(server.isRunning()).toBe(true);
    await server.stop();
    expect(server.isRunning()).toBe(false);
  });

  it('a second start() rejects while running', async () => {
    const server = new DevServer({ hotReload: false });
    await server.start();
    await expect(server.start()).rejects.toThrow(/already running/);
    await server.stop();
  });

  it('a second stop() is a no-op', async () => {
    const server = new DevServer({ hotReload: false });
    await server.start();
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
    expect(server.isRunning()).toBe(false);
  });

  it('starts and stops the watcher when hot reload is enabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dev-server-'));
    dirs.push(dir);
    const server = new DevServer({ hotReload: true, watchDir: dir });
    await server.start();
    expect(server.isRunning()).toBe(true);
    await server.stop();
    expect(server.isRunning()).toBe(false);
  });
});
