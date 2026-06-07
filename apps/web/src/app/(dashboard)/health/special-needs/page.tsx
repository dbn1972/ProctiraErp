/**
 * Special needs records list — access-controlled, v2.0 redesign.
 *
 * Validates: Requirement 12.1 — special needs tracking.
 *
 * Layout per redesign/web/health-special-needs.html:
 *  - Back link + page head with stats subtitle + Add to register CTA
 *  - Binding-accommodations notice
 *  - Table: avatar person-cell, need category tag, severity pill,
 *    accommodations, IEP pill, icon actions
 */
import Link from 'next/link';
import { ArrowLeft, Eye, Info, Pencil, Plus } from 'lucide-react';

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
  listSpecialNeeds,
  type SpecialNeedRecord,
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

export default async function SpecialNeedsPage() {
  const session = await requireSession('/health/special-needs');

  if (!canAccessHealthRecords(session.user.roles)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access denied</CardTitle>
          <CardDescription>
            Your role does not have permission to view special needs records.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const records = await listSpecialNeeds();
  const total = records.length;

  return (
    <section aria-labelledby="special-needs-heading" className="space-y-6">
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
            id="special-needs-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Special needs register
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total > 0
              ? `${total.toLocaleString()} students with identified needs · accommodations, assistive resources, and reviews`
              : 'Track accommodations and individualized education plans (IEPs).'}
          </p>
        </div>
        <Button size="sm">
          <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
          Add to register
        </Button>
      </div>

      {/* ── Binding notice ── */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200"
      >
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
        <p>
          <span className="font-semibold">Accommodations are binding. </span>
          Once recorded here, accommodations (extra exam time, scribes, front-row
          seating, accessible materials) are applied automatically in attendance,
          assessments, and examination seating plans. Schools are notified of every
          change.
        </p>
      </div>

      {/* ── Table card ── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Register</CardTitle>
          <CardDescription>
            {total.toLocaleString()} students with special needs.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {total === 0 ? (
            <p className="border-t py-12 text-center text-sm text-muted-foreground">
              No special needs records.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Special needs records">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="ps-4 font-semibold">Student</TableHead>
                    <TableHead className="font-semibold">Need category</TableHead>
                    <TableHead className="font-semibold">Severity</TableHead>
                    <TableHead className="font-semibold">Accommodations</TableHead>
                    <TableHead className="font-semibold">IEP</TableHead>
                    <TableHead className="pe-4 text-end font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <SpecialNeedRow key={r.id} record={r} />
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

function SpecialNeedRow({ record }: { record: SpecialNeedRecord }) {
  const palette = avatarPalette(record.studentName);

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
          <span className="min-w-0 truncate font-medium text-foreground">
            {record.studentName}
          </span>
        </div>
      </TableCell>

      {/* Need category */}
      <TableCell>
        {record.category ? (
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {record.category}
          </span>
        ) : (
          '—'
        )}
      </TableCell>

      {/* Severity */}
      <TableCell>
        <SeverityPill severity={record.severity} />
      </TableCell>

      {/* Accommodations */}
      <TableCell className="max-w-[280px] text-sm text-muted-foreground">
        {record.accommodations.length > 0 ? (
          record.accommodations.join(' · ')
        ) : (
          '—'
        )}
      </TableCell>

      {/* IEP */}
      <TableCell>
        {record.iepActive ? (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            Active
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            None
          </span>
        )}
      </TableCell>

      {/* Actions */}
      <TableCell className="pe-4">
        <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`View ${record.studentName}`}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`Edit ${record.studentName}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* --------------------------------------------------------------- micro-components */

function SeverityPill({ severity }: { severity: SpecialNeedRecord['severity'] }) {
  switch (severity) {
    case 'SEVERE':
      return (
        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-400">
          Severe
        </span>
      );
    case 'MODERATE':
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          Moderate
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          Mild
        </span>
      );
  }
}
