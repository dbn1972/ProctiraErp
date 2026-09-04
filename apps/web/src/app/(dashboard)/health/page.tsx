/**
 * Health records list (Server Component) — access-controlled, v2.0 redesign.
 *
 * Validates: Requirement 12.1 — health records access control.
 *
 * The route is gated client-side first via the requireSession() check in
 * the dashboard layout, then server-side again here against the role list.
 * The backend health-service enforces RBAC even when the frontend check
 * passes, so this is defence in depth.
 *
 * Layout per redesign/web/health-list.html:
 *  - Page head with stats subtitle + Special needs / Counselling actions
 *  - KPI cards (records / allergies flagged / chronic conditions tracked)
 *  - Confidentiality notice
 *  - Table: avatar person-cell, blood type, allergies, chronic conditions,
 *    last updated, icon actions
 */
import Link from 'next/link';
import {
  Eye,
  HeartPulse,
  Pencil,
  ShieldAlert,
  TriangleAlert,
  Users,
  Activity,
  Info,
} from 'lucide-react';

import {
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
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import {
  canAccessHealthRecords,
  listHealthRecords,
  type HealthRecord,
} from '@/lib/api/health';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------- helpers */

/** Avatar palette — literal class strings so Tailwind purge keeps them. */
const AVATAR_PALETTES = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300',
] as const;

function avatarPalette(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return `${first}${last}`.toUpperCase() || '—';
}

/* ------------------------------------------------------------------ page */

export default async function HealthRecordsPage() {
  const session = await requireSession('/health');

  if (!canAccessHealthRecords(session.user.roles)) {
    return <AccessDeniedCard />;
  }

  const records = await listHealthRecords();

  const total = records.length;
  const withAllergies = records.filter((r) => (r.allergies?.length ?? 0) > 0).length;
  const withChronic = records.filter(
    (r) => (r.chronicConditions?.length ?? 0) > 0,
  ).length;

  return (
    <section aria-labelledby="health-heading" className="space-y-6">
      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="health-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Health records
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total > 0
              ? `${total.toLocaleString()} confidential records · all access is audited`
              : 'Confidential medical information. All access is audited.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/health/special-needs">
              <Users className="me-1.5 h-4 w-4" aria-hidden="true" />
              Special needs
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/health/counselling">
              <Activity className="me-1.5 h-4 w-4" aria-hidden="true" />
              Counselling
            </Link>
          </Button>
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<HeartPulse className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Health records"
          value={total.toLocaleString()}
        />
        <KpiCard
          icon={<TriangleAlert className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
          label="Allergies flagged"
          value={withAllergies.toLocaleString()}
        />
        <KpiCard
          icon={<Activity className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
          label="Chronic conditions"
          value={withChronic.toLocaleString()}
        />
        <KpiCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          label="Special-needs register"
          value="Currently unavailable"
          valueClass="text-base font-semibold text-muted-foreground"
        />
      </div>

      {/* ── Confidentiality notice ── */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200"
      >
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
        <p>
          <span className="font-semibold">Confidential health information. </span>
          Findings and follow-up details are restricted to Health Officers and the
          school&apos;s medical staff. Class teachers see only the follow-up status,
          never the diagnosis.
        </p>
      </div>

      {/* ── Table card ── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Student health records</CardTitle>
          <CardDescription>
            {total.toLocaleString()} records accessible.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {total === 0 ? (
            <p className="border-t py-12 text-center text-sm text-muted-foreground">
              No health records available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Health records">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="ps-4 font-semibold">Student</TableHead>
                    <TableHead className="font-semibold">Blood type</TableHead>
                    <TableHead className="font-semibold">Allergies</TableHead>
                    <TableHead className="font-semibold">Chronic conditions</TableHead>
                    <TableHead className="font-semibold">Last updated</TableHead>
                    <TableHead className="pe-4 text-end font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <HealthRow key={record.id} record={record} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/* --------------------------------------------------------------- row */

function HealthRow({ record }: { record: HealthRecord }) {
  const palette = avatarPalette(record.studentName);
  const allergyCount = record.allergies?.length ?? 0;
  const chronicCount = record.chronicConditions?.length ?? 0;

  return (
    <TableRow className="group">
      {/* Student cell */}
      <TableCell className="ps-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              palette,
            )}
          >
            {initialsOf(record.studentName)}
          </span>
          <Link
            href={`/health/${record.studentId}`}
            className="min-w-0 truncate font-medium text-foreground hover:text-primary hover:underline"
          >
            {record.studentName}
          </Link>
        </div>
      </TableCell>

      {/* Blood type */}
      <TableCell className="font-mono text-sm text-foreground">
        {record.bloodType ?? '—'}
      </TableCell>

      {/* Allergies */}
      <TableCell>
        {allergyCount > 0 ? (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            {allergyCount} flagged
          </span>
        ) : (
          '—'
        )}
      </TableCell>

      {/* Chronic conditions */}
      <TableCell>
        {chronicCount > 0 ? (
          <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-400">
            {chronicCount} on record
          </span>
        ) : (
          '—'
        )}
      </TableCell>

      {/* Last updated */}
      <TableCell className="text-sm text-muted-foreground">
        {record.lastUpdated || '—'}
      </TableCell>

      {/* Actions */}
      <TableCell className="pe-4">
        <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`View ${record.studentName}`}
          >
            <Link href={`/health/${record.studentId}`}>
              <Eye className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`Edit ${record.studentName}`}
          >
            <Link href={`/health/${record.studentId}`}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* --------------------------------------------------------------- micro-components */

function KpiCard({
  icon,
  iconClass,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              iconClass,
            )}
          >
            {icon}
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <div
          className={cn(
            'mt-3 text-3xl font-extrabold tabular-nums text-foreground',
            valueClass,
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function AccessDeniedCard() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <div className="rounded-lg bg-destructive/10 p-2 text-destructive">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <CardTitle className="text-base">Access denied</CardTitle>
          <CardDescription>
            Your role does not have permission to access health records. Contact your
            administrator if you believe you should have access.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/home">Return to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
