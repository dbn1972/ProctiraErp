/**
 * /staff/[id] — Staff profile page (Server Component) — v2.0 redesign.
 *
 * Layout uses tabs for: overview, assignments, appraisals, training. Data is
 * loaded in parallel from staff, assignment, appraisal, and training services
 * through the API gateway.
 *
 * v2.0 changes:
 * - Profile head: large avatar + name + status pill inline; EMP-ID · designation
 *   · school · service years sub-meta
 * - "New appraisal" + "New assignment" outline + "Edit" primary in actions
 * - Tabs underline style
 * - Overview tab: 2-col layout — main (assignment cards + service history)
 *   + sidebar (details, leave balance, latest appraisal)
 * - Assignments / Appraisals / Training tabs kept fully intact
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Award, GitBranch, Pencil, Plus } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import {
  getStaff,
  listStaffAppraisals,
  listStaffAssignments,
  listStaffCertifications,
  type Appraisal,
  type Assignment,
  type Staff,
  type TrainingCertification,
} from '@/lib/api/staff';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/* ──────────────────────────────────────────── Avatar palette ── */

const AVATAR_PALETTES = [
  'bg-blue-100   text-blue-700   dark:bg-blue-900   dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  'bg-rose-100   text-rose-700   dark:bg-rose-900   dark:text-rose-300',
  'bg-amber-100  text-amber-700  dark:bg-amber-900  dark:text-amber-300',
  'bg-teal-100   text-teal-700   dark:bg-teal-900   dark:text-teal-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300',
] as const;

function avatarPalette(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0];
}

/* ──────────────────────────────────────────── customData helpers ── */

function readStr(cd: Record<string, unknown> | null | undefined, key: string): string {
  const v = cd?.[key];
  return typeof v === 'string' ? v : '';
}

function readArr(cd: Record<string, unknown> | null | undefined, key: string): string[] {
  const v = cd?.[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.trim())
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function readNum(cd: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = cd?.[key];
  return typeof v === 'number' ? v : null;
}

/* ──────────────────────────────────────────── Status pill ── */

const STATUS_PILL: Record<string, string> = {
  ACTIVE: 'bg-emerald-50  text-emerald-700  dark:bg-emerald-950/40 dark:text-emerald-400',
  INACTIVE: 'bg-zinc-100    text-zinc-600     dark:bg-zinc-800       dark:text-zinc-400',
  ON_LEAVE: 'bg-amber-50    text-amber-700    dark:bg-amber-950/40   dark:text-amber-400',
  PROBATION: 'bg-sky-50      text-sky-700      dark:bg-sky-950/40     dark:text-sky-400',
  SUSPENDED: 'bg-red-50      text-red-700      dark:bg-red-950/40     dark:text-red-400',
  RESIGNED: 'bg-zinc-100    text-zinc-500     dark:bg-zinc-800       dark:text-zinc-400',
  RETIRED: 'bg-zinc-100    text-zinc-500     dark:bg-zinc-800       dark:text-zinc-400',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ON_LEAVE: 'On leave',
  PROBATION: 'Probation',
  SUSPENDED: 'Suspended',
  RESIGNED: 'Resigned',
  RETIRED: 'Retired',
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_PILL[status] ?? 'bg-zinc-100 text-zinc-500';
  const label = STATUS_LABEL[status] ?? status;
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', cls)}>
      {label}
    </span>
  );
}

/* ──────────────────────────────────────────── FactRow ── */

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 border-b border-border/60 py-2 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-xs font-medium text-foreground">{children}</dd>
    </div>
  );
}

/* ──────────────────────────────────────────── Assignment cards ── */

function AssignmentCard({ assignment }: { assignment: Assignment }) {
  const classLabel = assignment.classId?.slice(0, 12) || '—';
  const subject = assignment.subjectId || '—';
  const roleNote = assignment.role !== 'SUBJECT_TEACHER' ? assignment.role : '';
  const room: string | null = null;
  const periods: number | null = null;

  const meta = [
    roleNote,
    assignment.startDate &&
      `Effective ${new Date(assignment.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    room && `Room ${room}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3">
      <span
        aria-hidden="true"
        className="flex min-w-[52px] shrink-0 items-center justify-center rounded-md bg-primary/10 px-2 py-1.5 text-center text-xs font-bold text-primary"
      >
        {classLabel}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{subject}</p>
        {meta && <p className="mt-0.5 text-[11px] text-muted-foreground">{meta}</p>}
      </div>
      {periods !== null && (
        <span className="shrink-0 text-xs font-bold text-foreground/70">
          {periods}&nbsp;periods/wk
        </span>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────── Service history timeline ── */

interface ServiceEvent {
  date?: string | null;
  title?: string | null;
  detail?: string | null;
  type?: 'assignment' | 'appraisal' | 'training' | 'transfer' | 'join' | string;
}

const TL_DOT_COLORS: Record<string, string> = {
  assignment: 'bg-primary   text-primary-foreground',
  appraisal: 'bg-emerald-500 text-white',
  training: 'bg-primary   text-primary-foreground',
  transfer: 'bg-amber-500 text-white',
  join: 'bg-emerald-500 text-white',
};

function ServiceHistoryCard({ events }: { events: ServiceEvent[] }) {
  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service history</CardTitle>
          <CardDescription>Postings, promotions, and milestones</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No service history recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Service history</CardTitle>
        <CardDescription>Postings, promotions, and milestones</CardDescription>
      </CardHeader>
      <CardContent className="pb-5">
        <ol className="space-y-0">
          {events.map((ev, i) => {
            const dotCls = TL_DOT_COLORS[ev.type ?? ''] ?? 'bg-muted text-muted-foreground';
            return (
              <li key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px]',
                      dotCls,
                    )}
                  >
                    ●
                  </span>
                  {i < events.length - 1 && (
                    <span aria-hidden="true" className="mt-1 h-8 w-px bg-border" />
                  )}
                </div>
                <div className={cn('min-w-0 pb-5', i === events.length - 1 && 'pb-0')}>
                  <p className="text-sm font-semibold leading-snug text-foreground">
                    {ev.title ?? '—'}
                  </p>
                  {ev.detail && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{ev.detail}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────── Leave balance sidebar ── */

interface LeaveBalance {
  label: string;
  used: number;
  total: number;
}

function LeaveBalanceCard({ balances, staffId }: { balances: LeaveBalance[]; staffId: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Leave balance</CardTitle>
        <CardDescription className="text-xs">Current year</CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        {balances.length === 0 ? (
          <p className="text-xs text-muted-foreground">No leave data available.</p>
        ) : (
          <div className="space-y-2">
            {balances.map((b) => (
              <div key={b.label} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{b.label}</span>
                <span className="font-semibold tabular-nums">
                  {b.total - b.used} of {b.total} left
                </span>
              </div>
            ))}
          </div>
        )}
        <Button asChild variant="outline" size="sm" className="mt-4 w-full">
          <Link href={`/staff/${staffId}/leaves/new`}>Apply for leave</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────── Latest appraisal sidebar ── */

function LatestAppraisalCard({
  appraisal,
  staffId,
}: {
  appraisal: Appraisal | null;
  staffId: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Latest appraisal</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        {appraisal ? (
          <div className="flex items-start gap-3">
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              {appraisal.totalScore.toFixed(1)} / 5
            </span>
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                {appraisal.status === 'APPROVED' ? 'Approved' : appraisal.status}
              </p>
              <p>{appraisal.appraisalDate}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No appraisals recorded yet.</p>
        )}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mt-3 w-full justify-start px-0 text-xs"
        >
          <Link href={`/staff/${staffId}/appraisals/new`}>Start new appraisal →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────── Overview tab (2-col) ── */

function OverviewTab({
  staff,
  assignments,
  appraisals,
}: {
  staff: Staff;
  assignments: Assignment[];
  appraisals: Appraisal[];
}) {
  const cd = staff.customData ?? {};

  // Assignments
  const activeAssignments = assignments.filter((a) => a.status === 'ACTIVE');
  // periodsPerWeek is not in the Assignment type; use allocation% as proxy
  const totalPeriods = 0;
  const maxPeriods = readNum(cd, 'maxWeeklyPeriods') ?? 24;

  // Service history from customData
  const rawHistory = cd['serviceHistory'];
  const serviceEvents: ServiceEvent[] = Array.isArray(rawHistory)
    ? (rawHistory as ServiceEvent[])
    : [];

  // Leave balance
  const rawLeave = cd['leaveBalance'];
  const leaveBalances: LeaveBalance[] = Array.isArray(rawLeave) ? (rawLeave as LeaveBalance[]) : [];

  // Latest appraisal
  const latestAppraisal = appraisals.length > 0 ? (appraisals[0] ?? null) : null;

  const qualification = readStr(cd, 'qualification');
  const school = readStr(cd, 'institutionName') || readStr(cd, 'schoolName');
  const subjects = readArr(cd, 'subjects');
  const designation = readStr(cd, 'designation') || staff.position;
  const joinDate = readStr(cd, 'joinDate') || readStr(cd, 'joinedDate');

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      {/* Main */}
      <div className="space-y-5">
        {/* Teaching assignments */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Teaching assignments</CardTitle>
                <CardDescription>
                  {totalPeriods > 0
                    ? `${totalPeriods} of ${maxPeriods} weekly periods allocated`
                    : 'Current academic year'}
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/staff/${staff.id}/assignments/new`}>
                  <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
                  Add
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 pb-5">
            {activeAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active assignments.</p>
            ) : (
              activeAssignments.map((a) => <AssignmentCard key={a.id} assignment={a} />)
            )}
            {totalPeriods > 0 && (
              <div className="pt-2">
                <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Weekly workload</span>
                  <span className="font-bold text-foreground">
                    {totalPeriods} / {maxPeriods} periods
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      totalPeriods / maxPeriods >= 0.9
                        ? 'bg-red-500'
                        : totalPeriods / maxPeriods >= 0.7
                          ? 'bg-emerald-500'
                          : 'bg-primary',
                    )}
                    style={{
                      width: `${Math.min(100, (totalPeriods / maxPeriods) * 100).toFixed(1)}%`,
                    }}
                    role="progressbar"
                    aria-valuenow={totalPeriods}
                    aria-valuemin={0}
                    aria-valuemax={maxPeriods}
                    aria-label="Weekly workload"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Service history */}
        <ServiceHistoryCard events={serviceEvents} />
      </div>

      {/* Sidebar */}
      <aside className="space-y-4" aria-label="Staff details sidebar">
        {/* Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Details</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <dl>
              <FactRow label="Employee ID">
                <span className="font-mono">{staff.identityNumber || '—'}</span>
              </FactRow>
              <FactRow label="Designation">{designation || '—'}</FactRow>
              {subjects.length > 0 && (
                <FactRow label="Subjects">
                  <div className="flex flex-wrap gap-1">
                    {subjects.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </FactRow>
              )}
              {school && <FactRow label="School">{school}</FactRow>}
              {joinDate && (
                <FactRow label="Joining date">
                  {new Date(joinDate).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </FactRow>
              )}
              {qualification && <FactRow label="Qualification">{qualification}</FactRow>}
              {staff.contactPhone && <FactRow label="Mobile">{staff.contactPhone}</FactRow>}
              {staff.contactEmail && (
                <FactRow label="Email">
                  <span className="break-all">{staff.contactEmail}</span>
                </FactRow>
              )}
            </dl>
          </CardContent>
        </Card>

        <LeaveBalanceCard balances={leaveBalances} staffId={staff.id} />
        <LatestAppraisalCard appraisal={latestAppraisal} staffId={staff.id} />
      </aside>
    </div>
  );
}

/* ──────────────────────────────────────────── Assignments tab ── */

function AssignmentsTab({ assignments, staffId }: { assignments: Assignment[]; staffId: string }) {
  const totalAllocation = assignments
    .filter((a) => a.status === 'ACTIVE')
    .reduce((sum, a) => sum + a.allocationPercentage, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Assignments</CardTitle>
          <CardDescription>
            Current and historical institution / class / subject assignments. Active total:{' '}
            {totalAllocation}%.
          </CardDescription>
        </div>
        <Button asChild size="sm">
          <Link href={`/staff/${staffId}/assignments/new`}>
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            Add assignment
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assignments yet.</p>
        ) : (
          <Table aria-label="Staff assignments">
            <TableHeader>
              <TableRow>
                <TableHead>Institution</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.institutionId}</TableCell>
                  <TableCell>{a.classId}</TableCell>
                  <TableCell>{a.subjectId}</TableCell>
                  <TableCell>{a.role}</TableCell>
                  <TableCell>{a.allocationPercentage}%</TableCell>
                  <TableCell>
                    {a.startDate} → {a.endDate ?? 'present'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.status === 'ACTIVE' ? 'success' : 'secondary'}>
                      {titleCase(a.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────── Appraisals tab ── */

function AppraisalsTab({ appraisals, staffId }: { appraisals: Appraisal[]; staffId: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Appraisals</CardTitle>
          <CardDescription>
            Performance appraisals routed through the workflow engine.
          </CardDescription>
        </div>
        <Button asChild size="sm">
          <Link href={`/staff/${staffId}/appraisals/new`}>
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            New appraisal
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {appraisals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No appraisals yet.</p>
        ) : (
          <Table aria-label="Staff appraisals">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Total score</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {appraisals.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.appraisalDate}</TableCell>
                  <TableCell>{a.templateId}</TableCell>
                  <TableCell>{a.totalScore.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === 'APPROVED' ? 'success' : 'secondary'}>
                      {titleCase(a.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────── Training tab ── */

function TrainingTab({ certifications }: { certifications: TrainingCertification[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Training & certifications</CardTitle>
        <CardDescription>
          Programs attended and certifications issued (Requirement 7.4).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {certifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No training records yet.</p>
        ) : (
          <Table aria-label="Training certifications">
            <TableHeader>
              <TableRow>
                <TableHead>Certification</TableHead>
                <TableHead>Program</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {certifications.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.certificationName}</TableCell>
                  <TableCell>{c.programId}</TableCell>
                  <TableCell>{c.issuedDate}</TableCell>
                  <TableCell>{c.expiryDate ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>
                      {titleCase(c.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────── Page ── */

export default async function StaffProfilePage(props: PageProps) {
  const params = await props.params;
  const staffId = params.id;
  const [staff, assignments, appraisals, certifications] = await Promise.all([
    getStaff(staffId),
    listStaffAssignments(staffId),
    listStaffAppraisals(staffId),
    listStaffCertifications(staffId),
  ]);

  if (!staff) {
    notFound();
  }

  const cd = staff.customData ?? {};
  const fullName = `${staff.firstName} ${staff.lastName}`;
  const initials = `${staff.firstName.charAt(0)}${staff.lastName.charAt(0)}`.toUpperCase();
  const palette = avatarPalette(fullName);
  const designation = readStr(cd, 'designation') || staff.position;
  const subjects = readArr(cd, 'subjects');
  const school = readStr(cd, 'institutionName') || readStr(cd, 'schoolName');
  const joinDate = readStr(cd, 'joinDate') || readStr(cd, 'joinedDate');
  const serviceYears = joinDate
    ? Math.floor((Date.now() - new Date(joinDate).getTime()) / (1000 * 60 * 60 * 24 * 365))
    : null;

  // Build sub-meta line for profile head
  const subMetaParts = [
    staff.identityNumber && (
      <span key="id" className="font-mono">
        {staff.identityNumber}
      </span>
    ),
    (designation || subjects.length > 0) && (
      <span key="desig">
        {designation}
        {subjects.length > 0 ? `, ${subjects.join(' & ')}` : ''}
      </span>
    ),
    school && <span key="school">{school}</span>,
    serviceYears !== null && serviceYears > 0 && (
      <span key="service">{serviceYears} yrs service</span>
    ),
  ].filter(Boolean);

  return (
    <section aria-labelledby="staff-profile-heading" className="space-y-6">
      {/* ── Profile head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold',
              palette,
            )}
          >
            {initials}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1
                id="staff-profile-heading"
                className="text-2xl font-extrabold tracking-tight text-foreground"
              >
                {fullName}
              </h1>
              <StatusPill status={staff.status} />
            </div>
            {subMetaParts.length > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
                {subMetaParts.map((part, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <span aria-hidden="true" className="select-none">
                        ·
                      </span>
                    )}
                    {part}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/staff/${staff.id}/appraisals/new`}>
              <Award className="me-1.5 h-4 w-4" aria-hidden="true" />
              New appraisal
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/staff/${staff.id}/assignments/new`}>
              <GitBranch className="me-1.5 h-4 w-4" aria-hidden="true" />
              New assignment
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href={`/staff/${staff.id}/edit`}>
              <Pencil className="me-1.5 h-4 w-4" aria-hidden="true" />
              Edit
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="overview">
        <TabsList
          aria-label="Staff information sections"
          className="rounded-none border-b border-border bg-transparent p-0"
        >
          <TabsTrigger
            value="overview"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="assignments"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Assignments
            {assignments.length > 0 && (
              <span className="ms-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {assignments.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="appraisals"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Appraisals
            {appraisals.length > 0 && (
              <span className="ms-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {appraisals.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="training"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
          >
            Training
            {certifications.length > 0 && (
              <span className="ms-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {certifications.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-5">
          <OverviewTab staff={staff} assignments={assignments} appraisals={appraisals} />
        </TabsContent>

        <TabsContent value="assignments" className="space-y-4 pt-5">
          <AssignmentsTab assignments={assignments} staffId={staff.id} />
        </TabsContent>

        <TabsContent value="appraisals" className="space-y-4 pt-5">
          <AppraisalsTab appraisals={appraisals} staffId={staff.id} />
        </TabsContent>

        <TabsContent value="training" className="space-y-4 pt-5">
          <TrainingTab certifications={certifications} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

/* ──────────────────────────────────────────── helpers ── */

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
