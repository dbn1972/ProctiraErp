/**
 * Dashboard data hooks (Task 52.2 → wired to real API in Task 60.3).
 *
 * Each hook returns a TanStack-Query–compatible shape (`{ data, isLoading,
 * error }`). The implementation calls the real API client from
 * `@/lib/api/dashboards.ts`. PRC-M577: failures (incl. 401/403/5xx) are
 * surfaced as `error`; sample data is never substituted.
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
  fetchStateDashboard,
} from '@/lib/api/dashboards';

import type {
  BoardAdminDashboardData,
  BoardComparisonData,
  CountryDashboardData,
  CrossBoardTransferData,
  DashboardQueryResult,
  StateDashboardData,
} from './types';

/**
 * Generic hook that calls an async fetcher. PRC-M577: failures (401/403/5xx,
 * network) are surfaced as `error`; sample data is never substituted.
 */
function useApiQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
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
        setData(undefined);
        setError(err instanceof Error ? err : new Error('Dashboard unavailable'));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-supplied deps
  }, deps);

  return {
    data,
    isLoading: data === undefined && error === null,
    error,
  };
}

/**
 * `GET /api/v1/dashboards/country`
 *
 * Fetches the country-level dashboard aggregate from the backend.
 * Failures are surfaced as `error` (PRC-M577); no sample data is substituted.
 */
export function useCountryDashboardData(): DashboardQueryResult<CountryDashboardData> {
  return useApiQuery((signal) => fetchCountryDashboard(signal));
}

/**
 * `GET /api/v1/dashboards/state/:stateId`
 *
 * Fetches the state-level dashboard aggregate from the backend.
 * Failures are surfaced as `error` (PRC-M577); no sample data is substituted.
 */
export function useStateDashboardData(
  stateCode?: string,
): DashboardQueryResult<StateDashboardData> {
  return useApiQuery(
    (signal) => fetchStateDashboard(stateCode ?? 'MH', signal),
  );
}

/**
 * `GET /api/v1/dashboards/board-admin/:boardId`
 *
 * Fetches the board admin dashboard aggregate from the backend.
 * Failures are surfaced as `error` (PRC-M577); no sample data is substituted.
 */
export function useBoardAdminDashboardData(
  boardCode?: string,
): DashboardQueryResult<BoardAdminDashboardData> {
  return useApiQuery(
    (signal) => fetchBoardAdminDashboard(boardCode ?? 'cbse', signal),
  );
}

/**
 * `GET /api/v1/dashboard/board-comparison`
 *
 * Fetches the board comparison data (data-warehouse rollup). Failures are
 * surfaced as `error` (PRC-M577).
 */
export function useBoardComparisonData(
  boardCodes?: ReadonlyArray<string>,
): DashboardQueryResult<BoardComparisonData> {
  return useApiQuery((signal) => fetchBoardComparison(boardCodes, signal));
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
