/**
 * Overview tab — Server Component — v2.0 redesign.
 *
 * 2-column layout:
 *  - Main:    KPI grid (students/staff/attendance/classrooms),
 *             enrollment-by-grade bar chart, recent activity timeline
 *  - Sidebar: key facts, contact details
 *
 * All metric data is read from `customData` with graceful "Currently
 * unavailable" fallbacks — no fabricated numbers, no raw UUIDs.
 */
import Link from 'next/link';
import {
  AlertTriangle,
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
import { getInstitution } from '@/lib/institutions/api';
import { loadAreaOptions, loadTypeOptions } from '@/lib/institutions/lookups';

interface OverviewPageProps {
  params: Promise<{ id: string }>;
}

/* ──────────────────────────────── helpers ── */

function nameFor(options: { id: string; name: string }[], id: string): string {
  return (
    options
      .find((o) => o.id === id)
      ?.name.replace(/^(—\s)+/, '')
      .trim() ?? ''
  );
}

function readStr(cd: Record<string, unknown> | null | undefined, key: string): string {
  const v = cd?.[key];
  return typeof v === 'string' ? v : '';
}

function readNum(cd: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = cd?.[key];
  return typeof v === 'number' ? v : null;
}

/* ──────────────────────────────── KPI card ── */

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  label: string;
  value: number | string | null;
  suffix?: string;
  foot?: string;
}

function KpiCard({ icon: Icon, iconBg, label, value, suffix, foot }: KpiCardProps) {
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
            {typeof value === 'number' ? value.toLocaleString() : value}
            {suffix && <span className="text-lg font-bold text-muted-foreground">{suffix}</span>}
          </p>
        ) : (
          <p className="text-sm font-medium text-muted-foreground">Currently unavailable</p>
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
}: {
  data: GradeEnrollment[];
  institutionId: string;
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
          <p className="py-6 text-center text-sm text-muted-foreground">
            Enrollment data is currently unavailable for this institution.
          </p>
        ) : (
          <div className="space-y-1">
            {data.map((row) => (
              <div
                key={row.grade}
                className="grid grid-cols-[48px_1fr_48px] items-center gap-3 py-1"
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
                  {row.count.toLocaleString()}
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

const TONE_DOT: Record<string, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  brand: 'bg-primary',
};

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
            {items.map((item, i) => (
              <li key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                      TONE_DOT[item.tone ?? 'brand'],
                    )}
                  />
                  {i < items.length - 1 && (
                    <span aria-hidden="true" className="mt-1 h-full min-h-[24px] w-px bg-border" />
                  )}
                </div>
                <div className={cn('min-w-0 pb-4', i === items.length - 1 && 'pb-0')}>
                  <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
                  {item.meta && <p className="mt-0.5 text-xs text-muted-foreground">{item.meta}</p>}
                </div>
              </li>
            ))}
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
  const [institution, areas, types] = await Promise.all([
    getInstitution(params.id),
    loadAreaOptions(),
    loadTypeOptions(),
  ]);

  const cd = (institution as unknown as { customData?: Record<string, unknown> }).customData ?? {};
  const areaName = nameFor(areas, institution.areaId);
  const typeName = nameFor(types, institution.typeId);

  const studentCount = readNum(cd, 'studentCount');
  const staffCount = readNum(cd, 'staffCount');
  const attendance = readNum(cd, 'attendance');
  const classrooms = readNum(cd, 'classroomCount');

  const rawEnroll = cd['enrollmentByGrade'];
  const enrollment: GradeEnrollment[] = Array.isArray(rawEnroll)
    ? (rawEnroll as GradeEnrollment[]).filter(
        (e) => e && typeof e.grade === 'string' && typeof e.count === 'number',
      )
    : [];

  const rawActivity = cd['recentActivity'];
  const activity: ActivityItem[] = Array.isArray(rawActivity)
    ? (rawActivity as ActivityItem[]).filter((a) => a && typeof a.title === 'string')
    : [];

  const medium = readStr(cd, 'medium');
  const established = readStr(cd, 'established') || (readNum(cd, 'established')?.toString() ?? '');
  const shift = readStr(cd, 'shift');
  const headmaster = readStr(cd, 'headmaster');

  return (
    <div className="space-y-6">
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
            />
            <KpiCard
              icon={Users}
              iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
              label="Staff"
              value={staffCount}
            />
            <KpiCard
              icon={TrendingUp}
              iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
              label="Attendance"
              value={attendance}
              suffix={attendance !== null ? '%' : undefined}
            />
            <KpiCard
              icon={Grid3x3}
              iconBg="bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
              label="Classrooms"
              value={classrooms}
            />
          </div>

          <EnrollmentByGrade data={enrollment} institutionId={institution.id} />
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
