/**
 * @vitest-environment jsdom
 *
 * PRC-L546 — ConnectivityProvider boot/sync orchestration.
 *
 * Drives the REAL provider:
 *   • heartbeat HEAD failure → status becomes `offline`;
 *   • a browser `online` event → `syncing` while replayAll drains, then back
 *     to `online`;
 *   • a 409 replay outcome surfaces to the UI by dispatching a `sync:conflict`
 *     window event (consumed by the conflict dialog / indicator).
 *
 * The sync queue is mocked so the test controls replay outcomes without
 * touching IndexedDB.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { SYNC_CONFLICT_EVENT } from '@/lib/sync/conflict';

const replayAll = vi.fn();
const getOperation = vi.fn();

vi.mock('@/lib/sync/syncQueue', () => ({
  replayAll: (...args: unknown[]) => replayAll(...args),
  getOperation: (...args: unknown[]) => getOperation(...args),
}));

import { ConnectivityProvider, useConnectivity } from './ConnectivityProvider';

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

function wrapper(fetcher: typeof fetch) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ConnectivityProvider heartbeatInterval={1000} syncFetcher={fetcher}>
        {children}
      </ConnectivityProvider>
    );
  };
}

describe('ConnectivityProvider (PRC-L546)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replayAll.mockReset();
    getOperation.mockReset();
    replayAll.mockResolvedValue([]);
    setOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('transitions to offline when the heartbeat HEAD fails', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const { result } = renderHook(() => useConnectivity(), { wrapper: wrapper(fetcher) });

    expect(result.current.status).toBe('online');
    await act(async () => {
      vi.advanceTimersByTime(1000); // fire one heartbeat
      await Promise.resolve();
    });
    expect(result.current.status).toBe('offline');
  });

  it('replays the queue on the online event: syncing → online', async () => {
    let resolveReplay: (v: unknown[]) => void = () => undefined;
    replayAll.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReplay = resolve as (v: unknown[]) => void;
        }),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 })) as unknown as typeof fetch;
    const { result } = renderHook(() => useConnectivity(), { wrapper: wrapper(fetcher) });

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    expect(result.current.status).toBe('syncing');
    expect(replayAll).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveReplay([]);
      await Promise.resolve();
    });
    expect(result.current.status).toBe('online');
  });

  it('surfaces a 409 replay conflict as a sync:conflict window event', async () => {
    const conflictBody = JSON.stringify({
      field_conflicts: [
        {
          field: 'name',
          server_value: 'server',
          server_version: 'v7',
          client_value: 'local',
        },
      ],
      server_record: { id: 'stu-1', name: 'server' },
      resolution_token: 'tok-123',
    });
    replayAll.mockResolvedValue([
      {
        id: 'op-1',
        outcome: 'failed_permanent',
        status: 409,
        responseBody: conflictBody,
      },
    ]);
    getOperation.mockResolvedValue({
      id: 'op-1',
      operationType: 'PUT',
      targetEntity: 'student',
      targetId: 'stu-1',
      payload: { url: '/api/students/stu-1', body: JSON.stringify({ name: 'local' }) },
    });

    const conflictEvents: Event[] = [];
    const onConflict = (e: Event) => conflictEvents.push(e);
    window.addEventListener(SYNC_CONFLICT_EVENT, onConflict);

    const fetcher = vi.fn() as unknown as typeof fetch;
    const { result } = renderHook(() => useConnectivity(), { wrapper: wrapper(fetcher) });

    await act(async () => {
      await result.current.replaySyncQueue();
    });

    window.removeEventListener(SYNC_CONFLICT_EVENT, onConflict);
    expect(conflictEvents.length).toBe(1);
    const detail = (conflictEvents[0] as CustomEvent).detail as { queueId: string };
    expect(detail.queueId).toBe('op-1');
    // Drain finished → status restored.
    expect(result.current.status).toBe('online');
  });

  it('is re-entrant: a second concurrent replay is a no-op', async () => {
    let resolveReplay: (v: unknown[]) => void = () => undefined;
    replayAll.mockImplementation(
      () => new Promise((resolve) => (resolveReplay = resolve as (v: unknown[]) => void)),
    );
    const fetcher = vi.fn() as unknown as typeof fetch;
    const { result } = renderHook(() => useConnectivity(), { wrapper: wrapper(fetcher) });

    await act(async () => {
      void result.current.replaySyncQueue();
      await Promise.resolve();
    });
    // Second call while the first drain is in flight returns [] without a new replayAll.
    let second: unknown[] = [{ marker: true }];
    await act(async () => {
      second = await result.current.replaySyncQueue();
    });
    expect(second).toEqual([]);
    expect(replayAll).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveReplay([]);
      await Promise.resolve();
    });
  });

  it('throws when useConnectivity is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useConnectivity())).toThrow(/within a <ConnectivityProvider>/);
    spy.mockRestore();
  });
});
