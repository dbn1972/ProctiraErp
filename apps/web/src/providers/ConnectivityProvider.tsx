/**
 * ConnectivityProvider — Online/offline/syncing state (Design §I)
 *
 * Owns the connectivity tri-state (online, offline, syncing) and exposes a
 * `useConnectivity()` hook. Monitors `navigator.onLine` and a periodic
 * heartbeat HEAD ping to `/api/health` (every 30 s) to detect connectivity
 * changes within 5 s (Requirement 38.2 / 38.3).
 *
 * Sync_Queue integration (task 54.2):
 *   • On the browser `online` event, the provider transitions to
 *     `syncing` and calls `replayAll()` with the global `fetch`. The
 *     status returns to `online` once the drain completes.
 *   • The provider also exposes `replaySyncQueue()` so the
 *     Connectivity_Indicator (task 54.3) and the conflict dialog
 *     (task 54.5) can trigger a manual replay (e.g. after the user
 *     amends a queued operation).
 *
 * Requirements: 38.1, 38.2, 38.3, 38.5, 38.6, 38.7
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

import { replayAll, getOperation, type ReplayResult } from '@/lib/sync/syncQueue';
import {
  SYNC_CONFLICT_EVENT,
  parseConflictPayload,
  parseLocalPayload,
  type SyncConflictEventDetail,
} from '@/lib/sync/conflict';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConnectivityStatus = 'online' | 'offline' | 'syncing';

export interface ConnectivityContextValue {
  /** Current connectivity state */
  status: ConnectivityStatus;
  /** Whether the app is currently online (status === 'online' || status === 'syncing') */
  isOnline: boolean;
  /** Whether the sync queue is actively replaying */
  isSyncing: boolean;
  /** Manually trigger a connectivity check */
  checkConnectivity: () => Promise<void>;
  /**
   * Drain the Sync_Queue immediately. Resolves with the per-operation
   * outcomes so the caller can summarise progress. While the drain
   * runs, `status` is `syncing`.
   */
  replaySyncQueue: () => Promise<ReplayResult[]>;
}

// ─── SSR-safe helpers ────────────────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function getInitialOnlineStatus(): boolean {
  if (!isBrowser()) return true; // Assume online during SSR
  return navigator.onLine;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Heartbeat interval in milliseconds (30 seconds) */
const HEARTBEAT_INTERVAL_MS = 30_000;

// ─── Context ─────────────────────────────────────────────────────────────────

const ConnectivityContext = createContext<ConnectivityContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export interface ConnectivityProviderProps {
  children: React.ReactNode;
  /** Override heartbeat URL for testing */
  heartbeatUrl?: string;
  /** Override heartbeat interval for testing (ms) */
  heartbeatInterval?: number;
  /**
   * Fetcher used by the Sync_Queue replay. Defaults to the global
   * `fetch`. Tests may inject a mock to drive `replaySyncQueue`
   * behaviour without hitting the network.
   */
  syncFetcher?: typeof fetch;
}

export function ConnectivityProvider({
  children,
  heartbeatUrl = '/api/health',
  heartbeatInterval = HEARTBEAT_INTERVAL_MS,
  syncFetcher,
}: ConnectivityProviderProps) {
  const [status, setStatus] = useState<ConnectivityStatus>(() =>
    getInitialOnlineStatus() ? 'online' : 'offline'
  );
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Re-entrancy guard so concurrent triggers (online event + manual
  // call) don't replay the same operation twice.
  const drainingRef = useRef(false);

  const checkConnectivity = useCallback(async () => {
    if (!isBrowser()) return;

    // If the browser already knows we're offline, short-circuit without
    // attempting a fetch — keeps the indicator transitioning to offline
    // within 5 s of the underlying network change (Req 38.2).
    if (!navigator.onLine) {
      setStatus((prev) => (prev === 'syncing' ? prev : 'offline'));
      return;
    }

    // HEAD `/api/health` heartbeat (Design §I). A 2xx response confirms
    // the gateway is reachable; anything else (network error, 5xx,
    // CORS rejection) is treated as offline. The fetcher is the same
    // one that powers `replaySyncQueue` so test harnesses can drive
    // both pathways through a single mock.
    const fetcher = syncFetcher ?? globalThis.fetch.bind(globalThis);
    try {
      const response = await fetcher(heartbeatUrl, {
        method: 'HEAD',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (response.ok) {
        setStatus((prev) => (prev === 'syncing' ? prev : 'online'));
      } else {
        setStatus((prev) => (prev === 'syncing' ? prev : 'offline'));
      }
    } catch {
      setStatus((prev) => (prev === 'syncing' ? prev : 'offline'));
    }
  }, [heartbeatUrl, syncFetcher]);

  const replaySyncQueue = useCallback(async (): Promise<ReplayResult[]> => {
    if (!isBrowser()) return [];
    if (drainingRef.current) return [];
    drainingRef.current = true;
    setStatus('syncing');
    try {
      const fetcher = syncFetcher ?? globalThis.fetch.bind(globalThis);
      const results = await replayAll(fetcher);
      // Surface 409 conflicts to `<ConflictResolutionDialog>` (task
      // 54.5). Each parsable conflict gets a `sync:conflict` window
      // event carrying everything the dialog needs to render without
      // re-fetching. Non-parsable bodies are silently skipped — the
      // op still sits in the queue with its `lastError` so the user
      // can see it in the sync errors tray.
      await dispatchConflictEvents(results);
      return results;
    } catch {
      // Replay failures are surfaced per-operation via `lastError`;
      // a thrown error here is unexpected (e.g. IndexedDB blocked).
      // Falling through to the `finally` clause restores status.
      return [];
    } finally {
      drainingRef.current = false;
      setStatus(navigator.onLine ? 'online' : 'offline');
    }
  }, [syncFetcher]);

  // Listen to browser online/offline events
  useEffect(() => {
    if (!isBrowser()) return;

    const handleOnline = () => {
      setStatus('online');
      // Fire-and-forget: failures are reported via `lastError` per
      // queued operation; the UI surfaces them through the conflict
      // dialog (task 54.5).
      void replaySyncQueue();
    };

    const handleOffline = () => {
      setStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [replaySyncQueue]);

  // Periodic heartbeat check
  useEffect(() => {
    if (!isBrowser()) return;

    heartbeatRef.current = setInterval(() => {
      checkConnectivity();
    }, heartbeatInterval);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, [checkConnectivity, heartbeatInterval]);

  const value: ConnectivityContextValue = {
    status,
    isOnline: status === 'online' || status === 'syncing',
    isSyncing: status === 'syncing',
    checkConnectivity,
    replaySyncQueue,
  };

  return (
    <ConnectivityContext.Provider value={value}>
      {children}
    </ConnectivityContext.Provider>
  );
}

// ─── Conflict event dispatch ─────────────────────────────────────────────────

/**
 * Iterate `replayAll` results and fire one `sync:conflict` event per
 * parsable 409 outcome. Each event carries the local payload, the
 * parsed server envelope, and the originating route so the
 * `<ConflictResolutionDialog>` can render without any additional
 * round-trips.
 *
 * Non-409 permanent failures (e.g. a 422 validation error) are left
 * to the standard error toast; the op still sits in the queue for
 * the sync errors tray so the user can amend or discard from there.
 */
async function dispatchConflictEvents(results: readonly ReplayResult[]): Promise<void> {
  if (!isBrowser()) return;
  for (const result of results) {
    if (result.outcome !== 'failed_permanent' || result.status !== 409) continue;
    const conflict = parseConflictPayload(result.responseBody ?? '');
    if (!conflict) continue;
    const op = await getOperation(result.id);
    // The op may have been discarded between the persist and now —
    // there is nothing to resolve in that case.
    if (!op) continue;
    const detail: SyncConflictEventDetail = {
      queueId: op.id,
      method: op.operationType,
      url: op.payload.url,
      targetEntity: op.targetEntity,
      targetId: op.targetId,
      localPayload: parseLocalPayload(op.payload.body ?? null),
      conflict,
      rawResponseBody: result.responseBody ?? '',
    };
    window.dispatchEvent(new CustomEvent(SYNC_CONFLICT_EVENT, { detail }));
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Access the current connectivity state.
 * Must be used within a `<ConnectivityProvider>`.
 */
export function useConnectivity(): ConnectivityContextValue {
  const context = useContext(ConnectivityContext);
  if (context === undefined) {
    throw new Error('useConnectivity must be used within a <ConnectivityProvider>');
  }
  return context;
}
