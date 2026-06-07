/**
 * AttendanceDashboard — attendance KPIs and recent activity overview.
 *
 * Wired to the attendance-service API (Task 60.3):
 *   - GET /api/v1/attendance/percentage (aggregate stats)
 *
 * Displays attendance rate, absence rate, and breakdown by status
 * for the current institution and academic period.
 */
'use client';

import { useEffect, useState } from 'react';

import { browserGatewayFetch } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface AttendancePercentageResult {
  scope: string;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  lateCount: number;
  attendancePercentage: number;
  absencePercentage: number;
}

/* ------------------------------------------------------------------ Component */

export default function AttendanceDashboard() {
  const [stats, setStats] = useState<AttendancePercentageResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        // Fetch institution-level attendance for the current month
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .slice(0, 10);
        const endDate = now.toISOString().slice(0, 10);

        const params = new URLSearchParams();
        params.set('scope', 'institution');
        params.set('startDate', startDate);
        params.set('endDate', endDate);

        const result = await browserGatewayFetch<AttendancePercentageResult>(
          `/attendance/percentage?${params.toString()}`,
          { signal: controller.signal },
        );
        setStats(result);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to load attendance data');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Attendance Dashboard</h1>

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="attendance-dashboard-loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {/* KPI Cards */}
      {!isLoading && stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border bg-card p-4" data-testid="kpi-attendance-rate">
            <p className="text-sm text-muted-foreground">Attendance Rate</p>
            <p className="text-2xl font-bold text-green-600">
              {stats.attendancePercentage.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.presentCount + stats.lateCount} / {stats.totalRecords} days
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4" data-testid="kpi-absence-rate">
            <p className="text-sm text-muted-foreground">Absence Rate</p>
            <p className="text-2xl font-bold text-red-600">
              {stats.absencePercentage.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.absentCount} absent days
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4" data-testid="kpi-late-count">
            <p className="text-sm text-muted-foreground">Late Arrivals</p>
            <p className="text-2xl font-bold text-amber-600">{stats.lateCount}</p>
            <p className="text-xs text-muted-foreground mt-1">this period</p>
          </div>

          <div className="rounded-lg border bg-card p-4" data-testid="kpi-excused-count">
            <p className="text-sm text-muted-foreground">Excused Absences</p>
            <p className="text-2xl font-bold text-blue-600">{stats.excusedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">this period</p>
          </div>
        </div>
      )}

      {/* Empty state when no data */}
      {!isLoading && !stats && !error && (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No attendance data available for the current period.
        </div>
      )}
    </div>
  );
}
