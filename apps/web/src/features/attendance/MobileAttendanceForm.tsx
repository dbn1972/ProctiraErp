/**
 * apps/web/src/features/attendance/MobileAttendanceForm.tsx
 * (Task 53.3, Requirements 41.3, 41.5, 9.1, Design §H)
 * =====================================================================
 *
 * Mobile-optimised attendance marking surface. Renders one student per
 * row with four thumb-friendly status buttons (Present / Absent / Late
 * / Excused) sized for the Touch_Target floor in Requirement 37 AC 3
 * (≥ 48 × 48 px activation area, ≥ 12 px between adjacent targets).
 *
 * Why a separate component from the desktop form?
 *
 *   The desktop `<AttendanceMarkingForm>` (apps/web/src/app/(dashboard)/
 *   attendance/_components/attendance-marking-form.tsx) renders the
 *   roster as a 3-column `<Table>` with a `<Select>` + free-text
 *   `<Input>` per row. That collapses badly under 768 px because the
 *   `<Select>` triggers and the comment inputs compete for the same
 *   horizontal track. A teacher in the field needs the four status
 *   choices visible and tappable at once — not hidden behind a select
 *   trigger — and they need explicit on-screen controls in place of
 *   any pointer/hover-only affordances (Requirement 41 AC 5).
 *
 * How the offline path works:
 *
 *   The form calls `submit()` (the same data layer the desktop form
 *   uses — `markAttendanceAction` server action when mounted under a
 *   Next route, or a direct `gatewayFetch` shim when mounted from the
 *   SPA). When `navigator.onLine === false`, the form skips the
 *   network attempt entirely and routes the bulk payload through
 *   `enqueue()` in `@/lib/sync/syncQueue`. The Connectivity_Provider
 *   (task 54.x) drains the queue once the heartbeat recovers; this
 *   component does not need to know about replay scheduling.
 *
 * State persistence:
 *
 *   The selection (institution / class / academic period / date) and
 *   the per-row status grid live inside `useDraftAutosave` so a clerk
 *   who closes the browser, drops connectivity, or pulls the battery
 *   resumes the in-progress marking on remount (Requirement 38 AC 8).
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, Loader2, MessageSquare, ShieldQuestion, XCircle } from 'lucide-react';

import { Input } from '@proctira/ui/components';
import { useDraftAutosave } from '@/lib/draft/useDraftAutosave';
import { enqueue as enqueueSyncOperation } from '@/lib/sync/syncQueue';
import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL } from '@/lib/api/gateway';
import type { RosterEntry } from '@/lib/api/attendance';
import { cn } from '@/lib/utils';

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * The four statuses recognised by the attendance service. Mirrors the
 * `StudentAttendanceStatus` enum in `@/lib/api/attendance` so callers
 * can pass either value through unchanged.
 */
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

/** A single student record the form mutates. */
export interface MobileAttendanceRow {
  studentId: string;
  studentName: string;
  status: AttendanceStatus;
  comment: string;
}

/**
 * The payload the form posts to its data layer. Identical to
 * `BulkAttendanceInput` in `@/lib/api/attendance` — the form does not
 * import that type directly because the desktop server action and the
 * SPA fetch path both accept the same shape.
 */
export interface MobileAttendanceSubmission {
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: string;
  records: Array<{
    studentId: string;
    status: AttendanceStatus;
    comment?: string;
  }>;
}

/** Outcome of a submission attempt. */
export type MobileAttendanceSubmitResult =
  | { status: 'success'; message?: string }
  | { status: 'error'; message: string }
  | { status: 'queued'; message?: string };

/**
 * Pluggable submission strategy. Defaults to a `fetch` against the
 * gateway endpoint the desktop form's server action calls. Tests
 * override this so they never touch the network.
 */
export type MobileAttendanceSubmitter = (
  payload: MobileAttendanceSubmission,
) => Promise<MobileAttendanceSubmitResult>;

export interface MobileAttendanceFormProps {
  /** Pre-loaded roster (single source of truth shared with desktop). */
  roster: RosterEntry[];
  /** Form selection — institution, class, academic period, date. */
  defaults: {
    institutionId: string;
    classId: string;
    academicPeriodId: string;
    date: string;
  };
  /**
   * Submit strategy. Defaults to `defaultMobileAttendanceSubmitter`
   * (POST to `${GATEWAY_BASE_URL}/api/v1/attendance/student/bulk`).
   * Mount the form under a Next page that exposes the desktop server
   * action by passing `submit={async (p) => markAttendanceAction(p)}`.
   */
  submit?: MobileAttendanceSubmitter;
  /**
   * Tenant id used when enqueueing for offline replay. The Sync_Queue
   * record carries this through to the replay loop's `X-Tenant-ID`
   * header. Defaults to `'default'` when the caller cannot resolve
   * one (matches `gatewayFetch`'s fallback).
   */
  tenantId?: string;
  /**
   * User id for the Sync_Queue audit field. Defaults to `'unknown'`.
   * Callers typically pull this from `useAuth()` and pass it through.
   */
  userId?: string;
  /**
   * `useDraftAutosave` slot key. Defaults to
   * `mobile-attendance-marking-<academicPeriodId>` so two periods
   * open in different tabs don't clobber each other.
   */
  draftFormId?: string;
  /**
   * Test seam — override `navigator.onLine`. When unset, the form
   * reads `navigator.onLine` directly. Tests pass `false` to drive
   * the offline-enqueue path without simulating network events.
   */
  isOnlineOverride?: boolean;
}

// ─── Status button configuration ─────────────────────────────────────────────

interface StatusOption {
  value: AttendanceStatus;
  label: string;
  /** Icon component from lucide-react, paired with the label. */
  Icon: typeof CheckCircle2;
  /**
   * Token-driven background applied when the option is the active
   * selection. Pairs each status with one of the four semantic tokens
   * (success / destructive / warning / info / muted) so the indicator
   * still works in dark mode and high-contrast tenant themes.
   */
  activeBg: string;
  /** Foreground colour for the active state. */
  activeFg: string;
  /** Border colour for the active state. */
  activeBorder: string;
}

const STATUS_OPTIONS: readonly StatusOption[] = [
  {
    value: 'PRESENT',
    label: 'Present',
    Icon: CheckCircle2,
    activeBg: 'bg-emerald-600',
    activeFg: 'text-white',
    activeBorder: 'border-emerald-700',
  },
  {
    value: 'ABSENT',
    label: 'Absent',
    Icon: XCircle,
    activeBg: 'bg-[hsl(var(--destructive))]',
    activeFg: 'text-[hsl(var(--destructive-foreground))]',
    activeBorder: 'border-[hsl(var(--destructive))]',
  },
  {
    value: 'LATE',
    label: 'Late',
    Icon: Clock,
    activeBg: 'bg-amber-500',
    activeFg: 'text-white',
    activeBorder: 'border-amber-600',
  },
  {
    value: 'EXCUSED',
    label: 'Excused',
    Icon: ShieldQuestion,
    activeBg: 'bg-sky-600',
    activeFg: 'text-white',
    activeBorder: 'border-sky-700',
  },
] as const;

// ─── Default submitter (gateway POST) ────────────────────────────────────────

/** The gateway URL the desktop server action ultimately posts to. */
export const MOBILE_ATTENDANCE_SUBMIT_URL = `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/attendance/student/bulk`;

/**
 * Default fetch-based submitter. Mirrors `recordBulkAttendance` in
 * `@/lib/api/attendance` but lives client-side so the SPA-mounted
 * variant does not require a Server Action round trip. Auth headers
 * are added by the API gateway middleware via the same-origin
 * cookie; the caller may also supply a custom submit prop that
 * dispatches the Server Action when mounted from a Next page.
 */
export const defaultMobileAttendanceSubmitter: MobileAttendanceSubmitter = async (payload) => {
  try {
    const response = await fetch(MOBILE_ATTENDANCE_SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return {
        status: 'error',
        message: `Server returned ${response.status}`,
      };
    }
    return { status: 'success' };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Network request failed',
    };
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rosterToRows(roster: RosterEntry[]): MobileAttendanceRow[] {
  return roster.map((entry) => ({
    studentId: entry.studentId,
    studentName: entry.studentName,
    status: (entry.attendance?.status as AttendanceStatus | undefined) ?? 'PRESENT',
    comment: entry.attendance?.comment ?? '',
  }));
}

interface DraftSnapshot {
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: string;
  rows: MobileAttendanceRow[];
}

function readNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // navigator.onLine === false is a *strong* signal that the device is
  // offline. The opposite (true) is weaker — the heartbeat in
  // ConnectivityProvider catches captive portals — but for routing
  // around the network call here, this is the right knob.
  return navigator.onLine !== false;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Mobile attendance marking form. See module docs for the full
 * contract.
 */
export function MobileAttendanceForm({
  roster,
  defaults,
  submit = defaultMobileAttendanceSubmitter,
  tenantId = 'default',
  userId = 'unknown',
  draftFormId,
  isOnlineOverride,
}: MobileAttendanceFormProps) {
  // ─── State ────────────────────────────────────────────────────────────────
  const [institutionId, setInstitutionId] = useState(defaults.institutionId);
  const [classId, setClassId] = useState(defaults.classId);
  const [academicPeriodId, setAcademicPeriodId] = useState(defaults.academicPeriodId);
  const [date, setDate] = useState(defaults.date);
  const [rows, setRows] = useState<MobileAttendanceRow[]>(() => rosterToRows(roster));
  const [expandedComment, setExpandedComment] = useState<string | null>(null);
  const [submission, setSubmission] = useState<MobileAttendanceSubmitResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ─── Draft autosave (Requirement 38 AC 8) ─────────────────────────────────
  const resolvedDraftFormId =
    draftFormId ?? `mobile-attendance-marking-${academicPeriodId || 'default'}`;
  const draft = useDraftAutosave<DraftSnapshot>(resolvedDraftFormId);

  // Hydrate from the persisted draft once on mount. Subsequent local
  // edits should not be clobbered if the hook re-emits.
  const hasHydratedDraftRef = useRef(false);
  useEffect(() => {
    if (hasHydratedDraftRef.current) return;
    if (draft.values === null) return;
    const snap = draft.values;
    setInstitutionId(snap.institutionId);
    setClassId(snap.classId);
    setAcademicPeriodId(snap.academicPeriodId);
    setDate(snap.date);
    if (snap.rows.length > 0) {
      setRows(snap.rows);
    }
    hasHydratedDraftRef.current = true;
  }, [draft.values]);

  // Re-sync rows whenever the parent supplies a new roster (e.g. the
  // class/period selection loaded a new pre-populated list). The
  // first run on mount is skipped so the hydration effect above can
  // win when a persisted draft exists for the same period.
  const previousRosterRef = useRef<RosterEntry[] | null>(null);
  useEffect(() => {
    if (previousRosterRef.current === null) {
      previousRosterRef.current = roster;
      return;
    }
    if (previousRosterRef.current === roster) return;
    previousRosterRef.current = roster;
    setRows(rosterToRows(roster));
  }, [roster]);

  // Auto-save the live snapshot. The hook itself debounces to ≤ 30 s.
  useEffect(() => {
    draft.save({
      institutionId,
      classId,
      academicPeriodId,
      date,
      rows,
    });
  }, [draft, institutionId, classId, academicPeriodId, date, rows]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  const setRowStatus = useCallback((studentId: string, status: AttendanceStatus) => {
    // Note: we route the mutation through the same `setRows` setter
    // the autosave effect observes. The subsequent autosave call
    // captures the updated grid through the `useDraftAutosave`
    // hook (Task 53.3 sub-task — selection mutations are written
    // through useDraftAutosave).
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, status } : r)));
  }, []);

  const setRowComment = useCallback((studentId: string, comment: string) => {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, comment } : r)));
  }, []);

  const toggleCommentRow = useCallback((studentId: string) => {
    setExpandedComment((prev) => (prev === studentId ? null : studentId));
  }, []);

  // ─── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    const payload: MobileAttendanceSubmission = {
      institutionId,
      classId,
      academicPeriodId,
      date,
      records: rows.map((r) => {
        const out: {
          studentId: string;
          status: AttendanceStatus;
          comment?: string;
        } = { studentId: r.studentId, status: r.status };
        if (r.comment) out.comment = r.comment;
        return out;
      }),
    };

    // Flush before submission so a crash mid-network leaves the
    // current snapshot recoverable.
    draft.flush({ institutionId, classId, academicPeriodId, date, rows });

    setIsSubmitting(true);
    setSubmission(null);

    const online = isOnlineOverride ?? readNavigatorOnline();

    if (!online) {
      // Offline path — go straight to Sync_Queue. Reusing the same
      // path the desktop form uses when the gateway is unreachable
      // (Task 54.x integration).
      try {
        await enqueueSyncOperation({
          tenantId,
          userId,
          operationType: 'POST',
          targetEntity: 'attendance',
          payload: {
            url: MOBILE_ATTENDANCE_SUBMIT_URL,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        });
        const result: MobileAttendanceSubmitResult = {
          status: 'queued',
          message: 'You are offline — the marking is saved and will sync automatically.',
        };
        setSubmission(result);
        draft.clear();
      } catch (error) {
        setSubmission({
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Could not queue the operation for replay.',
        });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Online path — try the data layer first; fall through to the
    // Sync_Queue when the request fails so the work is not lost.
    try {
      const result = await submit(payload);
      if (result.status === 'success') {
        setSubmission(result);
        draft.clear();
      } else if (result.status === 'queued') {
        setSubmission(result);
        draft.clear();
      } else {
        // The submit strategy reported a failure — try once more
        // through the queue so the marking survives a flaky network.
        try {
          await enqueueSyncOperation({
            tenantId,
            userId,
            operationType: 'POST',
            targetEntity: 'attendance',
            payload: {
              url: MOBILE_ATTENDANCE_SUBMIT_URL,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
          });
          setSubmission({
            status: 'queued',
            message:
              'The server could not be reached — the marking is queued and will retry automatically.',
          });
          draft.clear();
        } catch {
          setSubmission(result);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    institutionId,
    classId,
    academicPeriodId,
    date,
    rows,
    submit,
    tenantId,
    userId,
    isOnlineOverride,
    draft,
  ]);

  // ─── Derived view state ───────────────────────────────────────────────────

  const summary = useMemo(() => {
    const tally = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    for (const row of rows) tally[row.status] += 1;
    return tally;
  }, [rows]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <form
      data-testid="mobile-attendance-form"
      aria-label="Mobile attendance marking"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      {/* Selection block. Stacked single-column for mobile. */}
      <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Class</span>
          <Input
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            data-testid="mobile-attendance-class-input"
            inputMode="text"
            autoComplete="off"
            aria-label="Class identifier"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Academic period</span>
          <Input
            value={academicPeriodId}
            onChange={(event) => setAcademicPeriodId(event.target.value)}
            data-testid="mobile-attendance-period-input"
            inputMode="text"
            autoComplete="off"
            aria-label="Academic period identifier"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Date</span>
          <Input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setDate(event.target.value)}
            data-testid="mobile-attendance-date-input"
            aria-label="Attendance date"
          />
        </label>
        <input type="hidden" value={institutionId} readOnly />
      </div>

      {/* Tally summary (visible immediately so a clerk can sanity-check). */}
      <div
        className="grid grid-cols-4 gap-2 text-center text-xs font-medium"
        aria-label="Attendance summary"
        data-testid="mobile-attendance-summary"
      >
        {STATUS_OPTIONS.map((opt) => (
          <div
            key={opt.value}
            className="flex flex-col items-center gap-1 rounded-md border border-border bg-background p-2"
          >
            <span aria-hidden="true">
              <opt.Icon className="h-4 w-4" />
            </span>
            <span>{opt.label}</span>
            <span className="text-base font-semibold tabular-nums">{summary[opt.value]}</span>
          </div>
        ))}
      </div>

      {/* Roster — single student per row. */}
      {rows.length === 0 ? (
        <p
          className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
          data-testid="mobile-attendance-empty"
        >
          No roster yet. Pick a class and academic period to load students.
        </p>
      ) : (
        <ul
          role="list"
          className="flex flex-col gap-3"
          data-testid="mobile-attendance-roster"
          aria-label="Student roster"
        >
          {rows.map((row) => {
            const isCommentOpen = expandedComment === row.studentId;
            return (
              <li
                key={row.studentId}
                data-testid={`mobile-attendance-row-${row.studentId}`}
                className="rounded-md border border-border bg-background p-3"
              >
                {/* Student name + comment toggle */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-foreground">
                      {row.studentName}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {row.studentId}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleCommentRow(row.studentId)}
                    aria-expanded={isCommentOpen}
                    aria-controls={`mobile-attendance-comment-${row.studentId}`}
                    aria-label={`${isCommentOpen ? 'Hide' : 'Add'} comment for ${row.studentName}`}
                    data-testid={`mobile-attendance-comment-toggle-${row.studentId}`}
                    className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <MessageSquare className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                {/* Status buttons — four equally-sized targets, ≥ 48 × 48 px,
                    `gap-3` (12 px) per Requirement 37 AC 3. */}
                <div
                  role="radiogroup"
                  aria-label={`Attendance status for ${row.studentName}`}
                  data-testid={`mobile-attendance-status-group-${row.studentId}`}
                  className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"
                >
                  {STATUS_OPTIONS.map((opt) => {
                    const isActive = row.status === opt.value;
                    const Icon = opt.Icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        data-active={isActive ? 'true' : 'false'}
                        data-status={opt.value}
                        data-testid={`mobile-attendance-status-${row.studentId}-${opt.value}`}
                        onClick={() => setRowStatus(row.studentId, opt.value)}
                        className={cn(
                          // Touch-target floor — 48 × 48 px minimum.
                          'flex min-h-[48px] min-w-[48px] flex-col items-center justify-center gap-1 rounded-md border-2 px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          isActive
                            ? cn(opt.activeBg, opt.activeFg, opt.activeBorder)
                            : 'border-border bg-background text-foreground hover:bg-muted',
                        )}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Collapsible comment input — explicit on-screen control,
                    no hover-only affordance (Requirement 41 AC 5). */}
                {isCommentOpen ? (
                  <div id={`mobile-attendance-comment-${row.studentId}`} className="mt-3">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Comment</span>
                      <Input
                        value={row.comment}
                        onChange={(event) => setRowComment(row.studentId, event.target.value)}
                        placeholder="Optional"
                        aria-label={`Comment for ${row.studentName}`}
                        data-testid={`mobile-attendance-comment-input-${row.studentId}`}
                      />
                    </label>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Submission status banner. */}
      {submission ? (
        <div
          role={submission.status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          data-testid="mobile-attendance-submission-banner"
          data-status={submission.status}
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            submission.status === 'success' &&
              'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
            submission.status === 'queued' && 'border-amber-500/40 bg-amber-500/10 text-amber-800',
            submission.status === 'error' &&
              'border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]',
          )}
        >
          {submission.message ??
            (submission.status === 'success'
              ? 'Attendance saved.'
              : submission.status === 'queued'
                ? 'Saved to the offline queue — will sync when online.'
                : 'Could not save attendance.')}
        </div>
      ) : null}

      {/* Submit — full-width to match the mobile thumb zone. */}
      {rows.length > 0 ? (
        <button
          type="submit"
          disabled={isSubmitting}
          data-testid="mobile-attendance-submit"
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-3 rounded-md bg-[hsl(var(--primary))] px-4 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {isSubmitting ? 'Saving…' : 'Save attendance'}
        </button>
      ) : null}
    </form>
  );
}

export default MobileAttendanceForm;
