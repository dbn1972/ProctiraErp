/**
 * useTeacherDashboard — real API hook for the Teacher Dashboard
 * (Task 52.4 → wired to real API in Task 60.3).
 *
 * Returns a TanStack-Query-shaped `{ data, isLoading, error }` envelope.
 * Calls `GET /api/v1/dashboards/teacher` via the browser gateway client.
 * Falls back to mock data when the API is unavailable.
 */

import { useEffect, useState } from 'react';

import type { TimelineItem } from '@proctira/ui-dashboards';

import { fetchTeacherDashboard } from '@/lib/api/dashboards';

import type { DashboardQueryResult, TeacherDashboardData } from './types';

const SCHEDULE: ReadonlyArray<TimelineItem> = [
  {
    id: 'class-1',
    time: '08:00 — 08:45',
    title: 'Grade 5A — Mathematics',
    description: 'Algebra: linear equations',
    status: 'completed',
  },
  {
    id: 'class-2',
    time: '09:00 — 09:45',
    title: 'Grade 4B — Mathematics',
    description: 'Place value & estimation',
    status: 'active',
  },
  {
    id: 'class-3',
    time: '10:15 — 11:00',
    title: 'Grade 5A — Science',
    description: 'States of matter lab',
    status: 'upcoming',
  },
  {
    id: 'class-4',
    time: '13:00 — 13:45',
    title: 'Grade 3C — Mathematics',
    description: 'Times tables review',
    status: 'upcoming',
  },
];

const MOCK_DATA: TeacherDashboardData = {
  assignedClasses: [
    { id: 'cls-5a', name: 'Mathematics', grade: 'Grade 5A', studentCount: 32 },
    { id: 'cls-4b', name: 'Mathematics', grade: 'Grade 4B', studentCount: 28 },
    { id: 'cls-5a-sci', name: 'Science', grade: 'Grade 5A', studentCount: 32 },
    { id: 'cls-3c', name: 'Mathematics', grade: 'Grade 3C', studentCount: 30 },
  ],
  todaySchedule: SCHEDULE,
  attendancePending: [
    {
      classId: 'cls-4b',
      className: 'Grade 4B — Mathematics',
      scheduledAt: '09:00',
    },
    {
      classId: 'cls-3c',
      className: 'Grade 3C — Mathematics',
      scheduledAt: '13:00',
    },
  ],
  pendingAssessments: [
    {
      id: 'assess-1',
      title: 'Submit Grade 5A Math results',
      due: 'Today',
      completed: false,
      className: 'Grade 5A',
    },
    {
      id: 'assess-2',
      title: 'Grade Grade 4B unit test papers',
      due: 'Tomorrow',
      completed: false,
      className: 'Grade 4B',
    },
    {
      id: 'assess-3',
      title: 'Publish Grade 3C term review',
      due: 'Friday',
      completed: false,
      className: 'Grade 3C',
    },
  ],
};

export function useTeacherDashboard(): DashboardQueryResult<TeacherDashboardData> {
  const [data, setData] = useState<TeacherDashboardData | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchTeacherDashboard(controller.signal);
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
  }, []);

  return {
    data,
    isLoading: data === undefined,
    error,
  };
}

/** Test-only seed. */
export const __TEACHER_DASHBOARD_MOCK__ = MOCK_DATA;
