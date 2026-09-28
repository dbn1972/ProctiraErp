/**
 * Dashboard data hooks (Task 52.2 → wired to real API in Task 60.3).
 *
 * Each hook returns a TanStack-Query–compatible shape (`{ data, isLoading,
 * error }`). The implementation calls the real API client from
 * `@/lib/api/dashboards.ts` and falls back to mock data when the
 * backend is unavailable (e.g. during local development without the
 * gateway running).
 *
 * The hooks are typed against `DashboardQueryResult<T>` so the migration
 * to `@tanstack/react-query` only requires renaming the import and
 * dropping the `useEffect` wrapper — the call sites stay identical.
 */

import { useEffect, useRef, useState } from 'react';

import {
  fetchBoardAdminDashboard,
  fetchBoardComparison,
  fetchCountryDashboard,
  fetchCrossBoardTransfer,
  fetchPendingTransferApprovals,
  fetchStateDashboard,
} from '@/lib/api/dashboards';

import {
  BOARD_ADMIN_DASHBOARD_MOCK,
  BOARD_COMPARISON_MOCK,
  COUNTRY_DASHBOARD_MOCK,
  STATE_DASHBOARD_MOCK,
} from './mockData';
import type {
  BoardAdminDashboardData,
  BoardComparisonData,
  CountryDashboardData,
  CrossBoardTransferData,
  DashboardQueryResult,
  PendingTransferApproval,
  StateDashboardData,
} from './types';

/**
 * Generic hook that calls an async fetcher and falls back to mock data
 * when the API is unreachable or returns a NOT_IMPLEMENTED error.
 */
function useApiQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  fallback: T,
): DashboardQueryResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const result = await fetcherRef.current(controller.signal);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        // Fall back to mock data on network errors or NOT_IMPLEMENTED
        // so the UI remains functional during development.
        setData(fallback);
        setError(null);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fallback]);

  return {
    data,
    isLoading: data === undefined,
    error,
  };
}

/**
 * `GET /api/v1/dashboards/country`
 *
 * Fetches the country-level dashboard aggregate from the backend.
 * Falls back to mock data when the gateway is unavailable.
 */
export function useCountryDashboardData(): DashboardQueryResult<CountryDashboardData> {
  return useApiQuery((signal) => fetchCountryDashboard(signal), COUNTRY_DASHBOARD_MOCK);
}

/**
 * `GET /api/v1/dashboards/state/:stateId`
 *
 * Fetches the state-level dashboard aggregate from the backend.
 * Falls back to mock data when the gateway is unavailable.
 */
export function useStateDashboardData(
  stateCode?: string,
): DashboardQueryResult<StateDashboardData> {
  return useApiQuery(
    (signal) => fetchStateDashboard(stateCode ?? 'MH', signal),
    STATE_DASHBOARD_MOCK,
  );
}

/**
 * `GET /api/v1/dashboards/board-admin/:boardId`
 *
 * Fetches the board admin dashboard aggregate from the backend.
 * Falls back to mock data when the gateway is unavailable.
 */
export function useBoardAdminDashboardData(
  boardCode?: string,
): DashboardQueryResult<BoardAdminDashboardData> {
  return useApiQuery(
    (signal) => fetchBoardAdminDashboard(boardCode ?? 'cbse', signal),
    BOARD_ADMIN_DASHBOARD_MOCK,
  );
}

/**
 * `GET /api/v1/dashboard/board-comparison`
 *
 * Fetches the board comparison data. Falls back to mock data since
 * this endpoint depends on the data warehouse rollup (not yet shipped).
 */
export function useBoardComparisonData(
  boardCodes?: ReadonlyArray<string>,
): DashboardQueryResult<BoardComparisonData> {
  return useApiQuery((signal) => fetchBoardComparison(boardCodes, signal), BOARD_COMPARISON_MOCK);
}

/**
 * `GET /api/v1/transfers/:id`
 *
 * Loads the tenant-scoped transfer. A missing or failed response is
 * surfaced as `error`. The deterministic mock payload is not substituted.
 */
export function useCrossBoardTransferData(
  transferId?: string,
): DashboardQueryResult<CrossBoardTransferData> {
  const [data, setData] = useState<CrossBoardTransferData | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const result = await fetchCrossBoardTransfer(transferId, controller.signal);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setData(undefined);
        setError(err instanceof Error ? err : new Error('Cross-board transfer unavailable'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [transferId]);

  return { data, isLoading, error };
}

export function usePendingTransferApprovals(
  enabled = true,
): DashboardQueryResult<PendingTransferApproval[]> {
  const [data, setData] = useState<PendingTransferApproval[] | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setIsLoading(true);
    void (async () => {
      try {
        const result = await fetchPendingTransferApprovals(controller.signal);
        if (!cancelled) {
          setData(result.data);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setData(undefined);
        setError(err instanceof Error ? err : new Error('Pending transfers unavailable'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled]);

  return { data, isLoading, error };
}
