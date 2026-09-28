/**
 * Overview tab — Server Component — v2.0 redesign.
 *
 * 2-column layout:
 *  - Main:    KPI grid (students/staff/attendance/classrooms),
 *             enrollment-by-grade bar chart, recent activity timeline
 *  - Sidebar: key facts, contact details
 *
 * KPI tiles prefer live list/hierarchy/attendance APIs, with graceful
 * "Currently unavailable" / customData fallbacks — no fabricated numbers.
 */
import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  GraduationCap,
  Grid3x3,
  Map as MapIcon,
  TrendingUp,
  Users,
} from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { ApiClientError, getInstitution, getInstitutionOverview } from '@/lib/institutions/api';
import { loadAreaOptions, loadTypeOptions, resolveLookupLabel } from '@/lib/institutions/lookups';

interface OverviewPageProps {
  params: Promise<{ id: string }>;
}

/* ──────────────────────────────── helpers ── */

function readStr(cd: Record<string, unknown> | null | undefined, key: string): string {
  const v = cd?.[key];
  return typeof v === 'string' ? v : '';
}

/* ──────────────────────────────── KPI card ── */

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  label: string;
  value: number | string | null;
  suffix?: string;
  foot?: string;
  retryHref: string;
}

function KpiCard({ icon: Icon, iconBg, label, value, suffix, foot, retryHref }: KpiCardProps) {
  const hasValue = value !== null && value !== '';
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <span
            aria-hidden="true"
            className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconBg)}
          >
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        {hasValue ? (
          <p className="text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
            {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
            {suffix && <span className="text-lg font-bold text-muted-foreground">{suffix}</span>}
          </p>
        ) : (
          <p className="text-sm font-medium text-muted-foreground">
            Currently unavailable.{' '}
            <Link href={retryHref} className="underline underline-offset-4">
              Retry
            </Link>
          </p>
        )}
        {foot && hasValue && <p className="mt-1 text-xs text-muted-foreground">{foot}</p>}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────── Enrollment bar chart ── */

interface GradeEnrollment {
  grade: string;
  count: number;
}

function EnrollmentByGrade({
  data,
  institutionId,
  unavailable,
}: {
  data: GradeEnrollment[];
  institutionId: string;
  unavailable: boolean;
}) {
  const max = data.reduce((m, d) => Math.max(m, d.count), 0) || 1;
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Enrollment by grade</CardTitle>
            <CardDescription>
              {data.length > 0
                ? `${total.toLocaleString()} students across ${data.length} grades`
                : 'Per-grade enrollment distribution'}
            </CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/institutions/${institutionId}/grades`}>Configure grades →</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-5">
        {data.length === 0 ? (
          <p
            className="py-6 text-center text-sm text-muted-foreground"
            data-testid="enrollment-empty"
          >
            {unavailable
              ? 'Enrollment data is currently unavailable for this institution.'
              : 'No students are enrolled in this institution yet.'}
          </p>
        ) : (
          <div className="space-y-1">
            {data.map((row) => (
              <div
                key={row.grade}
                className="grid grid-cols-[72px_1fr_48px] items-center gap-3 py-1"
              >
                <span className="text-sm font-semibold text-muted-foreground">{row.grade}</span>
                <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(4, (row.count / max) * 100).toFixed(1)}%` }}
                    role="img"
                    aria-label={`Grade ${row.grade}: ${row.count} students`}
                  />
                </div>
                <span className="text-end text-sm font-bold tabular-nums">
                  {row.count.toLocaleString('en-IN')}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────── Recent activity ── */

interface ActivityItem {
  title: string;
  meta?: string;
  tone?: 'green' | 'amber' | 'brand';
}

const TONE_ICON = {
  green: { Icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-600' },
  amber: { Icon: AlertTriangle, className: 'bg-amber-50 text-amber-600' },
  brand: { Icon: Bell, className: 'bg-primary/10 text-primary' },
} as const;

function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent activity</CardTitle>
        <CardDescription>Latest updates from this school</CardDescription>
      </CardHeader>
      <CardContent className="pb-5">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No recent activity recorded.
          </p>
        ) : (
          <ol className="space-y-0">
            {items.map((item, i) => {
              const tone = item.tone ?? 'brand';
              const visual = TONE_ICON[tone] ?? TONE_ICON.brand;
              const Icon = visual.Icon;
              return (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        visual.className,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {i < items.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="mt-1 h-full min-h-[24px] w-px bg-border"
                      />
                    )}
                  </div>
                  <div className={cn('min-w-0 pb-4', i === items.length - 1 && 'pb-0')}>
                    <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
                    {item.meta && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.meta}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────── Sidebar fact rows ── */

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 border-b border-border/60 py-2 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-xs font-medium text-foreground">{children}</dd>
    </div>
  );
}

/* ──────────────────────────────── Page ── */

export default async function InstitutionOverviewPage(props: OverviewPageProps) {
  const params = await props.params;
  const [institutionResult, areas, types] = await Promise.all([
    getInstitution(params.id).catch(() => null),
    loadAreaOptions(),
    loadTypeOptions(),
  ]);

  // Layout already soft-fails when the gateway is down; mirror that here so
  // live KPI fetches never crash the overview tab on an offline stack.
  if (!institutionResult) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Institution details are currently unavailable.
      </p>
    );
  }
  const institution = institutionResult;

  const cd = (institution as unknown as { customData?: Record<string, unknown> }).customData ?? {};
  const areaName = resolveLookupLabel(areas, institution.areaId);
  const typeName = resolveLookupLabel(types, institution.typeId);
  const retryHref = `/institutions/${institution.id}/overview`;

  let overviewError: string | null = null;
  const snapshot = await getInstitutionOverview(institution.id).catch((error: unknown) => {
    overviewError =
      error instanceof ApiClientError
        ? error.message
        : 'Institution details are currently unavailable.';
    return null;
  });

  const studentCount = snapshot?.studentsAvailable ? snapshot.students : null;
  const staffCount = snapshot?.staffAvailable ? snapshot.staff : null;
  const attendance = snapshot?.attendanceAvailable ? snapshot.attendancePercent : null;
  const classrooms = snapshot?.classroomsAvailable ? snapshot.classrooms : null;

  const enrollment: GradeEnrollment[] = snapshot?.enrollmentAvailable
    ? snapshot.enrollmentByGrade.map((row) => ({
        grade: row.name || row.code,
        count: row.count,
      }))
    : [];

  const activity: ActivityItem[] = snapshot?.activityAvailable ? snapshot.activity : [];

  const medium = snapshot?.facts.medium || readStr(cd, 'medium');
  const established = snapshot?.facts.established || readStr(cd, 'established');
  const shift = snapshot?.facts.shift || readStr(cd, 'shift');
  const headmaster = snapshot?.facts.headmaster || readStr(cd, 'headmaster');

  return (
    <div className="space-y-6" data-testid="institution-overview">
      {institution.status === 'INACTIVE' && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">This institution is deactivated.</p>
            {institution.deactivationReason && (
              <p className="mt-1 text-amber-800 dark:text-amber-300">
                Reason: {institution.deactivationReason}
              </p>
            )}
          </div>
        </div>
      )}

      {overviewError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium">Service unavailable</p>
          <p className="mt-1 text-muted-foreground">
            {overviewError}{' '}
            <Link href={retryHref} className="font-semibold underline underline-offset-4">
              Retry
            </Link>
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Main column ── */}
        <div className="space-y-6">
          {/* KPI grid */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={GraduationCap}
              iconBg="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
              label="Students"
              value={studentCount}
              retryHref={retryHref}
            />
            <KpiCard
              icon={Users}
              iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
              label="Staff"
              value={staffCount}
              retryHref={retryHref}
            />
            <KpiCard
              icon={TrendingUp}
              iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
              label="Attendance"
              value={attendance}
              suffix={attendance !== null ? '%' : undefined}
              retryHref={retryHref}
            />
            <KpiCard
              icon={Grid3x3}
              iconBg="bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
              label="Classrooms"
              value={classrooms}
              retryHref={retryHref}
            />
          </div>

          <EnrollmentByGrade
            data={enrollment}
            institutionId={institution.id}
            unavailable={!snapshot?.enrollmentAvailable}
          />
          <RecentActivity items={activity} />
        </div>

        {/* ── Sidebar ── */}
        <aside className="space-y-4" aria-label="Institution facts and contact">
          {/* Key facts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Key facts</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <dl>
                <FactRow label="UDISE code">
                  <span className="font-mono">{institution.code}</span>
                </FactRow>
                {areaName && <FactRow label="Block">{areaName}</FactRow>}
                {typeName && <FactRow label="Type">{typeName}</FactRow>}
                {medium && <FactRow label="Medium">{medium}</FactRow>}
                {established && <FactRow label="Established">{established}</FactRow>}
                {shift && <FactRow label="Shift">{shift}</FactRow>}
                {headmaster && <FactRow label="Headmaster">{headmaster}</FactRow>}
              </dl>
            </CardContent>
          </Card>

          {/* Contact */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Contact</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <dl>
                <FactRow label="Phone">
                  {institution.contactPhone ? (
                    <a
                      href={`tel:${institution.contactPhone}`}
                      className="text-primary hover:underline"
                    >
                      {institution.contactPhone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Not on file</span>
                  )}
                </FactRow>
                <FactRow label="Email">
                  {institution.contactEmail ? (
                    <a
                      href={`mailto:${institution.contactEmail}`}
                      className="break-all text-primary hover:underline"
                    >
                      {institution.contactEmail}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Not on file</span>
                  )}
                </FactRow>
                <FactRow label="Address">
                  {institution.address || (
                    <span className="text-muted-foreground">Not on file</span>
                  )}
                </FactRow>
                {institution.latitude !== null && institution.longitude !== null && (
                  <FactRow label="Coordinates">
                    <span className="font-mono text-[11px]">
                      {institution.latitude}, {institution.longitude}
                    </span>
                  </FactRow>
                )}
              </dl>
              {institution.latitude !== null && institution.longitude !== null ? (
                <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${institution.latitude}&mlon=${institution.longitude}#map=16/${institution.latitude}/${institution.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="view-on-map"
                  >
                    <MapIcon className="me-1.5 h-4 w-4" aria-hidden="true" />
                    View on map
                  </a>
                </Button>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  Add coordinates in{' '}
                  <Link
                    href={`/institutions/${institution.id}/edit`}
                    className="underline underline-offset-4"
                  >
                    Edit institution
                  </Link>{' '}
                  to enable the map link.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
