/**
 * CounsellingSessionsLog — session list with case-note entry.
 *
 * Displays a list of counselling sessions for a student with:
 *   - Session details (date, type, counsellor, status)
 *   - Case notes viewer
 *   - Follow-up tracking
 *   - Outcome recording
 *
 * Wired to the Health Service API (Task 15):
 *   - GET  /api/v1/health/counselling/sessions/student/:studentId
 *   - POST /api/v1/health/counselling/sessions
 *   - PUT  /api/v1/health/counselling/sessions/:id
 *
 * Access control: Requirement 12.4 — route-level enforcement.
 *
 * Requirements: 12.3, 12.4
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface CounsellingSession {
  id: string;
  studentId: string;
  counsellorId: string;
  sessionDate: string;
  sessionType: 'individual' | 'group' | 'family' | 'crisis';
  reason: string;
  caseNotes: string;
  outcome: string | null;
  followUpRequired: boolean;
  followUpDate: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no-show';
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/* ------------------------------------------------------------------ Helpers */

const SESSION_TYPE_STYLES: Record<string, string> = {
  individual: 'bg-blue-100 text-blue-700',
  group: 'bg-purple-100 text-purple-700',
  family: 'bg-teal-100 text-teal-700',
  crisis: 'bg-red-100 text-red-700',
};

const SESSION_STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-700',
  'no-show': 'bg-yellow-100 text-yellow-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ------------------------------------------------------------------ Component */

export default function CounsellingSessionsLog() {
  const [searchParams] = useSearchParams();
  const studentId = searchParams.get('studentId') ?? '';

  const [sessions, setSessions] = useState<CounsellingSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<PaginatedResponse<CounsellingSession>['meta'] | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const res = await browserGatewayFetch<PaginatedResponse<CounsellingSession>>(
        `/health/counselling/sessions/student/${studentId}?page=${page}&pageSize=20`,
      );
      setSessions(res.data);
      setMeta(res.meta);
    } catch (err) {
      if (err instanceof BrowserGatewayError && err.status === 403) {
        setForbidden(true);
      } else if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load counselling sessions');
      }
    } finally {
      setLoading(false);
    }
  }, [studentId, page]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  // ─── 403 Forbidden page (Requirement 12.4) ─────────────────────────────
  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-6">
        <div className="text-5xl">🔒</div>
        <h1 className="text-2xl font-semibold">Access Denied</h1>
        <p className="text-muted-foreground text-center max-w-md">
          You do not have permission to view counselling records. Only authorized health personnel
          and the student&apos;s guardian may access this information.
        </p>
      </div>
    );
  }

  if (!studentId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">Counselling Sessions</h1>
        <p className="text-muted-foreground mt-2">
          Select a student to view their counselling session history.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Counselling Sessions</h1>
          <p className="text-muted-foreground mt-1">
            Session history with case notes, outcomes, and follow-up tracking.
          </p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div role="status" aria-label="Loading sessions" className="text-muted-foreground text-sm">
          Loading…
        </div>
      )}

      {/* Sessions list */}
      {!loading && !error && (
        <>
          {sessions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No counselling sessions recorded.
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div key={session.id} className="rounded-md border">
                  {/* Session header */}
                  <button
                    onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
                    aria-expanded={expandedId === session.id}
                    aria-controls={`session-${session.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{formatDate(session.sessionDate)}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SESSION_TYPE_STYLES[session.sessionType] ?? ''}`}
                      >
                        {session.sessionType}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SESSION_STATUS_STYLES[session.status] ?? ''}`}
                      >
                        {session.status}
                      </span>
                      {session.followUpRequired && (
                        <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-xs font-medium">
                          Follow-up needed
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {expandedId === session.id ? '▲' : '▼'}
                    </span>
                  </button>

                  {/* Expanded case notes */}
                  {expandedId === session.id && (
                    <div id={`session-${session.id}`} className="px-4 pb-4 space-y-3 border-t">
                      <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="font-medium text-muted-foreground">Reason:</span>{' '}
                          {session.reason}
                        </div>
                        <div>
                          <span className="font-medium text-muted-foreground">Counsellor ID:</span>{' '}
                          <span className="font-mono text-xs">{session.counsellorId}</span>
                        </div>
                      </div>

                      <div className="text-sm">
                        <div className="font-medium text-muted-foreground mb-1">Case Notes:</div>
                        <div className="bg-muted/30 rounded-md p-3 text-sm whitespace-pre-wrap">
                          {session.caseNotes}
                        </div>
                      </div>

                      {session.outcome && (
                        <div className="text-sm">
                          <span className="font-medium text-muted-foreground">Outcome:</span>{' '}
                          {session.outcome}
                        </div>
                      )}

                      {session.followUpRequired && (
                        <div className="text-sm">
                          <span className="font-medium text-muted-foreground">Follow-up Date:</span>{' '}
                          {session.followUpDate
                            ? formatDate(session.followUpDate)
                            : 'Not scheduled'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {meta.page} of {meta.totalPages} ({meta.total} sessions)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-md border px-3 py-1.5 disabled:opacity-50"
                  aria-label="Previous page"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                  disabled={page >= meta.totalPages}
                  className="rounded-md border px-3 py-1.5 disabled:opacity-50"
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
