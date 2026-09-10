/**
 * Counselling sessions list — access-controlled, v2.0 redesign.
 *
 * Validates: Requirement 12.1 — counselling sessions tracking.
 *
 * Layout per redesign/web/health-counselling.html:
 *  - Back link + page head with stats subtitle + Schedule session CTA
 *  - KPI cards (sessions / students supported / counsellors)
 *  - Restricted-register notice
 *  - Table: avatar person-cell, counsellor, session type tag, date,
 *    status pill, sealed-notes cell, icon actions
 */
import Link from 'next/link';
import {
  ArrowLeft,
  Clock,
  Eye,
  Info,
  Lock,
  MessageSquare,
  MoreVertical,
  Plus,
  User,
  Users,
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
  listCounsellingSessions,
  type CounsellingSession,
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
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '—';
}

/* ------------------------------------------------------------------ page */

export default async function CounsellingPage() {
  const session = await requireSession('/health/counselling');

  if (!canAccessHealthRecords(session.user.roles)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access denied</CardTitle>
          <CardDescription>
            Your role does not have permission to view counselling records.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const sessions = await listCounsellingSessions();

  const total = sessions.length;
  const studentsSupported = new Set(sessions.map((s) => s.studentId)).size;
  const upcoming = sessions.filter((s) => s.status === 'SCHEDULED').length;
  const counsellors = new Set(sessions.map((s) => s.counsellorName).filter(Boolean)).size;

  return (
    <section aria-labelledby="counselling-heading" className="space-y-6">
      {/* ── Back link ── */}
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/health">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Health &amp; Wellness
        </Link>
      </Button>

      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="counselling-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Counselling sessions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total > 0
              ? `${total.toLocaleString()} sessions on file · notes are sealed to the assigned counsellor`
              : 'Schedule and document student counselling sessions confidentially.'}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/health/counselling/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            Schedule session
          </Link>
        </Button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400"
          label="Sessions on file"
          value={total.toLocaleString()}
        />
        <KpiCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
          label="Students supported"
          value={studentsSupported.toLocaleString()}
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
          label="Upcoming / scheduled"
          value={upcoming.toLocaleString()}
        />
        <KpiCard
          icon={<User className="h-5 w-5" aria-hidden="true" />}
          iconClass="bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
          label="Counsellors active"
          value={counsellors.toLocaleString()}
        />
      </div>

      {/* ── Restricted notice ── */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200"
      >
        <Info
          className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400"
          aria-hidden="true"
        />
        <p>
          <span className="font-semibold">Restricted register. </span>
          Counselling records are visible only to Health Officers and the assigned counsellor.
          Session notes marked confidential are sealed and never appear in exports or reports.
        </p>
      </div>

      {/* ── Table card ── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Session register</CardTitle>
          <CardDescription>{total.toLocaleString()} sessions on file.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {total === 0 ? (
            <p className="border-t py-12 text-center text-sm text-muted-foreground">
              No counselling sessions recorded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Counselling sessions">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="ps-4 font-semibold">Student</TableHead>
                    <TableHead className="font-semibold">Counsellor</TableHead>
                    <TableHead className="font-semibold">Session type</TableHead>
                    <TableHead className="font-semibold">Date</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Notes</TableHead>
                    <TableHead className="pe-4 text-end font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <SessionRow key={s.id} session={s} />
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

function SessionRow({ session }: { session: CounsellingSession }) {
  const palette = avatarPalette(session.studentName);

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
            {initialsOf(session.studentName)}
          </span>
          <span className="min-w-0 truncate font-medium text-foreground">
            {session.studentName}
          </span>
        </div>
      </TableCell>

      {/* Counsellor */}
      <TableCell className="text-sm">{session.counsellorName || '—'}</TableCell>

      {/* Session type */}
      <TableCell>
        {session.topic ? (
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {session.topic}
          </span>
        ) : (
          '—'
        )}
      </TableCell>

      {/* Date */}
      <TableCell className="text-sm text-muted-foreground">{session.sessionDate || '—'}</TableCell>

      {/* Status */}
      <TableCell>
        <SessionStatus status={session.status} />
      </TableCell>

      {/* Sealed notes */}
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Sealed
        </span>
      </TableCell>

      {/* Actions */}
      <TableCell className="pe-4">
        <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`View session for ${session.studentName}`}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`More options for ${session.studentName}`}
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
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
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
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
        <div className="mt-3 text-3xl font-extrabold tabular-nums text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function SessionStatus({ status }: { status: CounsellingSession['status'] }) {
  switch (status) {
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
          Completed
        </span>
      );
    case 'CANCELLED':
      return (
        <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          Cancelled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
          Scheduled
        </span>
      );
  }
}
