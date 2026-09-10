/**
 * apps/web/src/features/mobile/MobileStudentProfile.tsx
 * (Task 53.4, Requirements 41.4, 41.5, Design §H)
 * =====================================================================
 *
 * Mobile-optimised student profile surface. Renders the student's
 * avatar, key identifiers, and three tabbed sections (Personal Info,
 * Attendance, Results) inside a column that fits the 320 px viewport
 * floor without horizontal scrolling (Requirement 41 AC 4).
 *
 * Why a separate file from the desktop `<StudentProfile>`?
 *
 *   The desktop profile spreads demographics, enrolment history,
 *   transfers, and assessment timelines across a wide multi-column
 *   layout. Squashing that under 320 px collapses the columns into an
 *   unreadable stack. The mobile surface trades the multi-column view
 *   for a stacked column with three tabbed sections so a parent or
 *   teacher can scan the most-asked information without scrolling
 *   sideways.
 *
 * Data layer:
 *
 *   The same gateway `getStudent()` / `getStudentEnrollments()` /
 *   `getStudentResults()` calls used by the desktop profile (see
 *   `apps/web/src/lib/api/students.ts` and `…/api/assessments.ts`)
 *   feed this surface in production. The route is registered behind
 *   the `legacy_mobile_routes` feature flag (Task 53.5) so this view
 *   is currently driven by demo/placeholder data; full server data
 *   wiring lands with the broader students-data task. Switching the
 *   `useStudentProfileData()` hook below to a real fetcher does not
 *   change the layout contract this task locks in.
 *
 * Tab bar:
 *
 *   Implemented with `<Tabs>` from `@proctira/ui/components`. We do
 *   not horizontally scroll the tabs themselves — three tabs at this
 *   width fit comfortably in a row at 320 px because each label is at
 *   most "Attendance" (10 chars) and the list uses `grid-cols-3` so
 *   the tab strip never overflows. The chevrons rendered alongside
 *   the swipe affordance use `<DirectionalIcon>` so they mirror in
 *   RTL locales (Requirement 18 AC 11).
 */

'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import {
  Avatar,
  AvatarFallback,
  Card,
  CardContent,
  DirectionalIcon,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@proctira/ui/components';

// ─── Demo data ───────────────────────────────────────────────────────────────
//
// The page reads a placeholder snapshot until the students-data task
// publishes the React Query hook. The shape mirrors what
// `getStudent()` + `getStudentEnrollments()` + `getStudentResults()`
// return so the swap is trivial.
//

interface StudentProfileSnapshot {
  id: string;
  initials: string;
  fullName: string;
  gradeSection: string;
  studentNumber: string;
  attendanceRate: string;
  letterGrade: string;
  classRank: string;
  personalInfo: ReadonlyArray<{ label: string; value: string }>;
  attendance: {
    presentDays: number;
    absentDays: number;
    lateDays: number;
    excusedDays: number;
    history: ReadonlyArray<{ date: string; status: string }>;
  };
  results: ReadonlyArray<{ subject: string; score: string; grade: string }>;
}

/**
 * Demo snapshot. Uses the same names as the prototype at
 * `School Platform Design/src/app/components/MobileStudentProfile.tsx`
 * so QA and design can compare side-by-side.
 */
const DEMO_SNAPSHOT: StudentProfileSnapshot = {
  id: 'STU-2024-001234',
  initials: 'AH',
  fullName: 'Ahmed Hassan',
  gradeSection: 'Grade 5 - Section A',
  studentNumber: 'STU-2024-001234',
  attendanceRate: '94.2%',
  letterGrade: 'B+',
  classRank: '8 / 42',
  personalInfo: [
    { label: 'Full Name', value: 'Ahmed Hassan' },
    { label: 'Date of Birth', value: '15 March 2013' },
    { label: 'Gender', value: 'Male' },
    { label: 'Nationality', value: 'Jordanian' },
    { label: 'National ID', value: '1234567890' },
    { label: 'Address', value: '45 Palm Street, District 1' },
    { label: 'Guardian Phone', value: '+962 7 1234 5678' },
  ],
  attendance: {
    presentDays: 168,
    absentDays: 8,
    lateDays: 3,
    excusedDays: 2,
    history: [
      { date: '15 Jan 2025', status: 'Present' },
      { date: '14 Jan 2025', status: 'Present' },
      { date: '13 Jan 2025', status: 'Late' },
      { date: '10 Jan 2025', status: 'Present' },
      { date: '09 Jan 2025', status: 'Excused' },
    ],
  },
  results: [
    { subject: 'Mathematics', score: '88', grade: 'A' },
    { subject: 'English', score: '82', grade: 'B+' },
    { subject: 'Science', score: '79', grade: 'B' },
    { subject: 'Social Studies', score: '85', grade: 'A-' },
    { subject: 'Hindi', score: '90', grade: 'A' },
  ],
};

/**
 * The hook that production data wiring will replace. Until then it
 * returns the demo snapshot synchronously so the layout contract this
 * task asserts is testable end-to-end.
 */
function useStudentProfileData(): StudentProfileSnapshot {
  return DEMO_SNAPSHOT;
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

type TabKey = 'info' | 'attendance' | 'results';

const TAB_LABELS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'info', label: 'Personal Info' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'results', label: 'Results' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function MobileStudentProfile() {
  const data = useStudentProfileData();
  const [activeTab, setActiveTab] = useState<TabKey>('info');

  // Memoise the tab index so the swipe arrows know whether to disable
  // themselves at the edges. Three tabs is a small list, but treating
  // it as data keeps the reducer obvious.
  const { previousLabel, nextLabel } = useMemo(() => {
    const index = TAB_LABELS.findIndex((tab) => tab.key === activeTab);
    return {
      previousLabel: index > 0 ? (TAB_LABELS[index - 1]?.label ?? null) : null,
      nextLabel:
        index >= 0 && index < TAB_LABELS.length - 1 ? (TAB_LABELS[index + 1]?.label ?? null) : null,
    };
  }, [activeTab]);

  return (
    <div
      // `overflow-x-hidden` is the explicit guard that satisfies
      // Requirement 41 AC 4 (no horizontal scroll). Combined with the
      // `max-w-full` constraint and the column layout below, the page
      // fits cleanly inside a 320 px viewport.
      className="flex w-full max-w-full flex-col overflow-x-hidden bg-background text-foreground"
      data-testid="mobile-student-profile"
    >
      {/* ─── Profile header ─────────────────────────────────────────── */}
      <header
        className="flex flex-col items-center gap-2 border-b border-border bg-background px-4 py-6 text-center"
        aria-label="Student profile header"
      >
        <Avatar
          className="h-20 w-20 bg-primary text-primary-foreground"
          data-testid="student-avatar"
        >
          <AvatarFallback className="text-2xl font-bold">{data.initials}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-0.5">
          <h1 className="truncate text-lg font-semibold" data-testid="student-full-name">
            {data.fullName}
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="student-grade-section">
            {data.gradeSection}
          </p>
          <p className="font-mono text-xs text-muted-foreground" data-testid="student-number">
            {data.studentNumber}
          </p>
        </div>

        {/* Key identifiers — three column grid that fits 320 px without
            wrapping (each cell is ~106 px wide). */}
        <dl className="mt-3 grid w-full grid-cols-3 gap-2" aria-label="Quick stats">
          <div className="flex flex-col items-center" data-testid="kpi-attendance">
            <dt className="text-[11px] text-muted-foreground">Attendance</dt>
            <dd className="text-lg font-bold text-success">{data.attendanceRate}</dd>
          </div>
          <div className="flex flex-col items-center" data-testid="kpi-grade">
            <dt className="text-[11px] text-muted-foreground">Grade</dt>
            <dd className="text-lg font-bold">{data.letterGrade}</dd>
          </div>
          <div className="flex flex-col items-center" data-testid="kpi-rank">
            <dt className="text-[11px] text-muted-foreground">Rank</dt>
            <dd className="text-lg font-bold">{data.classRank}</dd>
          </div>
        </dl>
      </header>

      {/* ─── Tabs ─────────────────────────────────────────────────────
          Three tabs (Personal Info, Attendance, Results). The
          `<TabsList>` uses `grid-cols-3` so the tab strip itself
          never overflows; chevrons inside the swipe row use
          `<DirectionalIcon>` so they mirror in RTL.
      */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabKey)}
        className="w-full max-w-full"
      >
        <div
          className="sticky top-0 z-10 border-b border-border bg-background"
          data-testid="mobile-student-profile-tabbar"
        >
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-none bg-transparent p-0 text-muted-foreground">
            {TAB_LABELS.map((tab) => (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                data-testid={`tab-${tab.key}`}
                className="min-h-[48px] truncate rounded-none border-b-2 border-transparent px-2 py-3 text-xs font-medium data-[state=active]:border-[hsl(var(--primary))] data-[state=active]:bg-transparent data-[state=active]:text-[hsl(var(--primary))] data-[state=active]:shadow-none"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Swipe affordance row — chevrons use `<DirectionalIcon>` so
              the arrow on the start side ("previous") and the arrow on
              the end side ("next") mirror correctly in RTL. */}
          <div
            className="flex items-center justify-between gap-2 px-4 py-1 text-[11px] text-muted-foreground"
            aria-hidden="true"
            data-testid="mobile-student-profile-swipe-hint"
          >
            <span className="flex min-w-0 items-center gap-1">
              <DirectionalIcon
                icon={ChevronLeft}
                className={previousLabel ? 'h-3 w-3 shrink-0' : 'h-3 w-3 shrink-0 opacity-30'}
                data-testid="tab-prev-chevron"
              />
              <span className="truncate">{previousLabel ?? '—'}</span>
            </span>
            <span className="flex min-w-0 items-center justify-end gap-1">
              <span className="truncate">{nextLabel ?? '—'}</span>
              <DirectionalIcon
                icon={ChevronRight}
                className={nextLabel ? 'h-3 w-3 shrink-0' : 'h-3 w-3 shrink-0 opacity-30'}
                data-testid="tab-next-chevron"
              />
            </span>
          </div>
        </div>

        {/* ── Personal Info ── */}
        <TabsContent value="info" className="mt-0 px-4 py-4" data-testid="tab-content-info">
          <h2 className="mb-2 text-sm font-semibold">Personal Information</h2>
          <Card className="border-none shadow-sm">
            <CardContent className="p-0">
              {data.personalInfo.map((item, index) => (
                <div
                  key={item.label}
                  className={
                    index === data.personalInfo.length - 1 ? 'p-3' : 'border-b border-border p-3'
                  }
                >
                  <p className="text-[11px] text-muted-foreground">{item.label}</p>
                  <p className="mt-0.5 break-words text-sm">{item.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Attendance ── */}
        <TabsContent
          value="attendance"
          className="mt-0 px-4 py-4"
          data-testid="tab-content-attendance"
        >
          <h2 className="mb-2 text-sm font-semibold">Attendance Summary</h2>
          <Card className="border-none shadow-sm">
            <CardContent className="grid grid-cols-2 gap-3 p-3">
              <AttendanceStat label="Present" value={data.attendance.presentDays} />
              <AttendanceStat label="Absent" value={data.attendance.absentDays} />
              <AttendanceStat label="Late" value={data.attendance.lateDays} />
              <AttendanceStat label="Excused" value={data.attendance.excusedDays} />
            </CardContent>
          </Card>

          <h2 className="mb-2 mt-4 text-sm font-semibold">Recent History</h2>
          <Card className="border-none shadow-sm">
            <CardContent className="p-0">
              {data.attendance.history.map((entry, index) => (
                <div
                  key={entry.date}
                  className={
                    index === data.attendance.history.length - 1
                      ? 'flex items-center justify-between p-3'
                      : 'flex items-center justify-between border-b border-border p-3'
                  }
                >
                  <span className="text-sm">{entry.date}</span>
                  <span className="text-xs text-muted-foreground">{entry.status}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Results ── */}
        <TabsContent value="results" className="mt-0 px-4 py-4" data-testid="tab-content-results">
          <h2 className="mb-2 text-sm font-semibold">Recent Results</h2>
          <Card className="border-none shadow-sm">
            <CardContent className="p-0">
              {data.results.map((result, index) => (
                <div
                  key={result.subject}
                  className={
                    index === data.results.length - 1
                      ? 'flex items-center justify-between p-3'
                      : 'flex items-center justify-between border-b border-border p-3'
                  }
                >
                  <span className="min-w-0 truncate text-sm">{result.subject}</span>
                  <span className="ms-2 flex shrink-0 items-baseline gap-2">
                    <span className="text-xs text-muted-foreground">{result.score}</span>
                    <span className="text-sm font-semibold">{result.grade}</span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AttendanceStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center rounded-md bg-muted/40 p-2">
      <span className="text-lg font-bold">{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
