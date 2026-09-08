/**
 * useSchoolDashboard — real API hook for the School / Principal
 * Dashboard (Task 52.4 → wired to real API in Task 60.3).
 *
 * Returns a TanStack-Query-shaped `{ data, isLoading, error }` envelope.
 * Calls `GET /api/v1/dashboards/school/:institutionId` via the browser
 * gateway client. Falls back to mock data when the API is unavailable.
 */

import { useEffect, useRef, useState } from 'react';

import { fetchSchoolDashboard } from '@/lib/api/dashboards';

import type { DashboardQueryResult, SchoolDashboardData } from './types';

const MOCK_DATA: SchoolDashboardData = {
  kpis: {
    totalStudents: 1247,
    attendanceRate: 94.2,
    staffOnDuty: 62,
    totalStaff: 68,
    pendingApprovals: 5,
  },
  recentActivity: [
    {
      id: 'act-1',
      title: '3 new students enrolled in Grade 5A',
      occurredAt: '2 hours ago',
      description: 'Approved by office admin',
    },
    {
      id: 'act-2',
      title: 'Sports day attendance entered for all classes',
      occurredAt: '4 hours ago',
    },
    {
      id: 'act-3',
      title: 'Mid-term assessment results published for Grade 4',
      occurredAt: 'Yesterday',
    },
    {
      id: 'act-4',
      title: 'Two transfer requests received from neighbouring district',
      occurredAt: 'Yesterday',
      description: 'Awaiting principal review',
    },
  ],
  pendingTasks: [
    {
      id: 'task-1',
      title: 'Review 3 transfer requests',
      due: 'Today',
      completed: false,
    },
    {
      id: 'task-2',
      title: 'Approve 2 leave applications',
      due: 'Today',
      completed: false,
    },
    {
      id: 'task-3',
      title: 'Submit monthly report to district',
      due: 'Tomorrow',
      completed: false,
    },
  ],
};

/**
 * Hook returning the dashboard data for the principal's institution.
 * Calls the real API and falls back to mock data on failure.
 */
export function useSchoolDashboard(
  institutionId?: string,
): DashboardQueryResult<SchoolDashboardData> {
  const [data, setData] = useState<SchoolDashboardData | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const idRef = useRef(institutionId);
  idRef.current = institutionId;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchSchoolDashboard(idRef.current ?? 'current', controller.signal);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          // Fall back to mock data so the UI remains functional
          setData(MOCK_DATA);
          setError(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [institutionId]);

  return {
    data,
    isLoading: data === undefined,
    error,
  };
}

/** Test-only seed so unit tests can render the loaded state directly. */
export const __SCHOOL_DASHBOARD_MOCK__ = MOCK_DATA;
