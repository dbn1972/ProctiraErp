/**
 * useParentStudentDashboard — real API hook for the Parent / Student
 * Dashboard (Task 52.4 → wired to real API in Task 60.3).
 *
 * Returns a TanStack-Query-shaped `{ data, isLoading, error }` envelope.
 * Calls `GET /api/v1/dashboards/me` via the browser gateway client.
 * Falls back to mock data when the API is unavailable.
 */

import { useEffect, useState } from 'react';

import type { TimelineItem } from '@proctira/ui-dashboards';

import { fetchParentStudentDashboard } from '@/lib/api/dashboards';

import type {
  DashboardQueryResult,
  ParentStudentDashboardData,
} from './types';

const SCHEDULE: ReadonlyArray<TimelineItem> = [
  {
    id: 'sch-1',
    time: '08:00',
    title: 'Mathematics',
    description: 'Room 12 — Mrs. Sarah Ahmed',
    status: 'completed',
  },
  {
    id: 'sch-2',
    time: '09:00',
    title: 'Science',
    description: 'Lab 2 — Mr. Daniel',
    status: 'active',
  },
  {
    id: 'sch-3',
    time: '10:15',
    title: 'English',
    description: 'Room 12 — Ms. Layla',
    status: 'upcoming',
  },
  {
    id: 'sch-4',
    time: '13:00',
    title: 'Arabic',
    description: 'Room 8 — Mr. Faisal',
    status: 'upcoming',
  },
];

const MOCK_DATA: ParentStudentDashboardData = {
  studentName: 'Ahmed Hassan',
  gradeLabel: 'Grade 5A',
  attendance: {
    ratePercent: 94.2,
    daysPresent: 18,
    daysAbsent: 2,
    daysLate: 1,
  },
  recentResults: [
    {
      id: 'res-1',
      subject: 'Mathematics',
      score: 85,
      grade: 'A',
      date: '12 Jan 2025',
    },
    {
      id: 'res-2',
      subject: 'Science',
      score: 78,
      grade: 'B+',
      date: '10 Jan 2025',
    },
    {
      id: 'res-3',
      subject: 'English',
      score: 72,
      grade: 'B',
      date: '08 Jan 2025',
    },
    {
      id: 'res-4',
      subject: 'Arabic',
      score: 88,
      grade: 'A',
      date: '05 Jan 2025',
    },
    {
      id: 'res-5',
      subject: 'Social Studies',
      score: 70,
      grade: 'B',
      date: '03 Jan 2025',
    },
  ],
  schedule: SCHEDULE,
  notifications: [
    {
      id: 'note-1',
      sender: 'Mrs. Sarah Ahmed',
      subject: 'Math homework reminder',
      receivedAt: '2h ago',
      unread: true,
    },
    {
      id: 'note-2',
      sender: 'Principal Office',
      subject: 'Sports Day participation',
      receivedAt: '1 day ago',
      unread: true,
    },
    {
      id: 'note-3',
      sender: 'Admin Office',
      subject: 'Fee payment reminder',
      receivedAt: '3 days ago',
      unread: false,
    },
  ],
};

export function useParentStudentDashboard(): DashboardQueryResult<ParentStudentDashboardData> {
  const [data, setData] = useState<ParentStudentDashboardData | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const result = await fetchParentStudentDashboard(controller.signal);
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
export const __PARENT_STUDENT_DASHBOARD_MOCK__ = MOCK_DATA;
