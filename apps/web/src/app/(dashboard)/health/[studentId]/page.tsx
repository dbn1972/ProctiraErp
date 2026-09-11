/**
 * Health record detail page — access-controlled, v2.0 redesign.
 *
 * Validates: Requirement 12.1 — view a single student's health record with
 * RBAC.
 *
 * Layout per redesign/web/health-student-detail.html:
 *  - Back link + profile head (avatar, name, blood-type meta)
 *  - Confidentiality notice
 *  - 2-col grid: main = allergies / chronic conditions cards;
 *    sidebar = care contacts via FactRow dl rows
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Heart, Plus, ShieldAlert, TriangleAlert } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { canAccessHealthRecords, getHealthRecord, listStudentVaccinations } from '@/lib/api/health';
import { cn } from '@/lib/utils';

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

interface PageProps {
  params: Promise<{ studentId: string }>;
}

export default async function HealthRecordPage(props: PageProps) {
  const params = await props.params;
  const session = await requireSession(`/health/${params.studentId}`);

  if (!canAccessHealthRecords(session.user.roles)) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <div className="rounded-lg bg-destructive/10 p-2 text-destructive">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">Access denied</CardTitle>
            <CardDescription>
              Your role does not allow access to this health record.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    );
  }

  const record = await getHealthRecord(params.studentId);
  if (!record) notFound();

  const vaccinations = await listStudentVaccinations(params.studentId);
  const palette = avatarPalette(record.studentName);

  return (
    <div className="space-y-6">
      {/* ── Back link ── */}
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/health">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to records
        </Link>
      </Button>

      {/* ── Profile head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold',
              palette,
            )}
          >
            {initialsOf(record.studentName)}
          </span>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              {record.studentName}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-mono">{record.bloodType ?? 'Blood type —'}</span>
              <span aria-hidden="true">·</span>
              <span>Last updated {record.lastUpdated || '—'}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            Record screening
          </Button>
        </div>
      </div>

      {/* ── Confidentiality notice ── */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200"
      >
        <Heart
          className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400"
          aria-hidden="true"
        />
        <p>
          <span className="font-semibold">Confidential medical record. </span>
          This profile is visible to you as a Health Officer. Sharing findings outside the school
          health programme requires written guardian consent.
        </p>
      </div>

      {/* ── 2-col layout ── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main column */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-3">
              <div className="rounded-lg bg-amber-50 p-2 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                <TriangleAlert className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-base">Allergies</CardTitle>
                <CardDescription>Reported allergies on file.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {record.allergies?.length ? (
                <ul className="flex flex-wrap gap-2">
                  {record.allergies.map((a) => (
                    <li
                      key={a}
                      className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                    >
                      {a}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None recorded.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Vaccinations</CardTitle>
              <CardDescription>Immunisation doses on file for this student.</CardDescription>
            </CardHeader>
            <CardContent>
              {vaccinations.length ? (
                <ul className="divide-y divide-border" role="list">
                  {vaccinations.map((v) => (
                    <li key={v.id} className="py-2 text-sm">
                      <span className="font-medium">{v.vaccineName}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · dose {v.doseNumber}
                        {v.dateAdministered ? ` · ${v.dateAdministered}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None recorded.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Chronic conditions</CardTitle>
              <CardDescription>Ongoing conditions under monitoring.</CardDescription>
            </CardHeader>
            <CardContent>
              {record.chronicConditions?.length ? (
                <ul className="flex flex-wrap gap-2">
                  {record.chronicConditions.map((c) => (
                    <li
                      key={c}
                      className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-400"
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None recorded.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Key information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm">
                <FactRow label="Blood group" value={record.bloodType ?? '—'} mono />
                <FactRow
                  label="Allergies"
                  value={record.allergies?.length ? `${record.allergies.length} on file` : 'None'}
                />
                <FactRow
                  label="Chronic conditions"
                  value={
                    record.chronicConditions?.length
                      ? `${record.chronicConditions.length} on file`
                      : 'None'
                  }
                />
                <FactRow label="Last updated" value={record.lastUpdated || '—'} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Care contacts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="text-sm">
                <FactRow label="Emergency contact" value={record.emergencyContactName ?? '—'} />
                <FactRow label="Emergency phone" value={record.emergencyContactPhone ?? '—'} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button className="w-full justify-center">Edit record</Button>
              <Button asChild variant="outline" className="w-full justify-center">
                <Link href="/health">Back to records</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- micro-components */

function FactRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 border-b border-border/60 py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-foreground', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}
