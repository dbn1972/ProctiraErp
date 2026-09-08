/**
 * AttendanceMarking — bulk per-class attendance marking screen.
 *
 * Wired to the attendance-service API (Task 60.3):
 *   - GET /api/v1/attendance/roster (pre-populate student list)
 *   - POST /api/v1/attendance/student/bulk (submit attendance)
 *   - GET /api/v1/attendance/config/:id (recording mode)
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

interface RosterEntry {
  studentId: string;
  studentName: string;
  enrollmentId: string;
  classId: string;
  gradeId: string;
  attendance?: {
    id: string;
    status: string;
    comment: string | null;
  };
}

interface AttendanceRecord {
  studentId: string;
  status: AttendanceStatus;
}

interface BulkAttendanceResponse {
  summary: {
    totalRecorded: number;
    totalUpdated: number;
    totalErrors: number;
  };
}

/* ------------------------------------------------------------------ Component */

export default function AttendanceMarking() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [records, setRecords] = useState<Map<string, AttendanceStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // In a real implementation these would come from route params or a selector
  const [classId] = useState('');
  const [date] = useState(new Date().toISOString().slice(0, 10));

  const fetchRoster = useCallback(async () => {
    if (!classId) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('classId', classId);
      params.set('date', date);
      params.set('academicPeriodId', 'current');
      const result = await browserGatewayFetch<{ data: RosterEntry[] }>(
        `/attendance/roster?${params.toString()}`,
      );
      setRoster(result.data);
      // Pre-fill existing attendance
      const existing = new Map<string, AttendanceStatus>();
      for (const entry of result.data) {
        if (entry.attendance) {
          existing.set(entry.studentId, entry.attendance.status as AttendanceStatus);
        }
      }
      setRecords(existing);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load class roster');
      }
    } finally {
      setIsLoading(false);
    }
  }, [classId, date]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const handleStatusChange = (studentId: string, status: AttendanceStatus) => {
    setRecords((prev) => {
      const next = new Map(prev);
      next.set(studentId, status);
      return next;
    });
  };

  const markAll = (status: AttendanceStatus) => {
    const next = new Map<string, AttendanceStatus>();
    for (const entry of roster) {
      next.set(entry.studentId, status);
    }
    setRecords(next);
  };

  const handleSubmit = async () => {
    if (!classId) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const attendanceRecords: AttendanceRecord[] = [];
      for (const [studentId, status] of records) {
        attendanceRecords.push({ studentId, status });
      }
      const result = await browserGatewayFetch<BulkAttendanceResponse>('/attendance/student/bulk', {
        method: 'POST',
        json: {
          institutionId: 'current',
          classId,
          academicPeriodId: 'current',
          date,
          records: attendanceRecords,
        },
      });
      setSuccess(
        `Attendance saved: ${result.summary.totalRecorded} recorded, ${result.summary.totalUpdated} updated.`,
      );
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to submit attendance');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const statuses: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Attendance Marking</h1>
        <span className="text-sm text-muted-foreground">{date}</span>
      </div>

      {!classId && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Select a class from the sidebar or navigation to begin marking attendance.
        </div>
      )}

      {/* Quick actions */}
      {roster.length > 0 && (
        <div className="flex gap-2">
          <button
            className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
            onClick={() => markAll('PRESENT')}
          >
            Mark All Present
          </button>
          <button
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            onClick={() => markAll('ABSENT')}
          >
            Mark All Absent
          </button>
        </div>
      )}

      {/* Error / Success */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {success}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3" data-testid="attendance-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {/* Roster table */}
      {!isLoading && roster.length > 0 && (
        <>
          <div className="rounded-md border">
            <table className="w-full text-sm" data-testid="attendance-roster">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Student</th>
                  {statuses.map((s) => (
                    <th key={s} className="px-3 py-3 text-center font-medium text-xs">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((entry) => (
                  <tr key={entry.studentId} className="border-b">
                    <td className="px-4 py-3 font-medium">{entry.studentName}</td>
                    {statuses.map((status) => (
                      <td key={status} className="px-3 py-3 text-center">
                        <input
                          type="radio"
                          name={`attendance-${entry.studentId}`}
                          checked={records.get(entry.studentId) === status}
                          onChange={() => handleStatusChange(entry.studentId, status)}
                          aria-label={`${entry.studentName} - ${status}`}
                          className="h-4 w-4"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={handleSubmit}
            disabled={isSubmitting || records.size === 0}
          >
            {isSubmitting ? 'Saving...' : 'Save Attendance'}
          </button>
        </>
      )}
    </div>
  );
}
