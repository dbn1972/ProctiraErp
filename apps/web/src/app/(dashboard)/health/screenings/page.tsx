/**
 * Health screenings list — access-controlled redesign screen.
 *
 * Validates: Requirement 12.5 — configurable screening programs.
 *
 * Nav label: Health · screenings → `/health/screenings`
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, ClipboardList, HeartPulse, Stethoscope } from 'lucide-react';

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
  listScreeningPrograms,
  type ScreeningProgram,
} from '@/lib/api/health';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function HealthScreeningsPage() {
  const session = await requireSession('/health/screenings');

  if (!canAccessHealthRecords(session.user.roles)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access denied</CardTitle>
          <CardDescription>
            Your role does not have permission to view health screenings.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const programs = await listScreeningPrograms();

  return (
    <section aria-labelledby="screenings-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ms-2 mb-2">
            <Link href="/health">
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Health records
            </Link>
          </Button>
          <h1
            id="screenings-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Screenings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {programs.length > 0
              ? `${programs.length} screening program${programs.length === 1 ? '' : 's'} scheduled`
              : 'Configure and track grade-level health screening programs.'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi
          icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />}
          label="Programs"
          value={String(programs.length)}
        />
        <Kpi
          icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
          label="Planned"
          value={String(programs.filter((p) => p.status === 'planned').length)}
        />
        <Kpi
          icon={<Stethoscope className="h-5 w-5" aria-hidden="true" />}
          label="In progress"
          value={String(programs.filter((p) => p.status === 'in-progress').length)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Screening programs</CardTitle>
          <CardDescription>
            Grade-level vision, hearing, dental, and wellness screenings.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Program</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Assessments</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {programs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No screening programs yet.
                  </TableCell>
                </TableRow>
              ) : (
                programs.map((program) => <ScreeningRow key={program.id} program={program} />)
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

function ScreeningRow({ program }: { program: ScreeningProgram }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-start gap-2">
          <HeartPulse className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <div className="font-medium">{program.name}</div>
            {program.description ? (
              <div className="text-xs text-muted-foreground">{program.description}</div>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="font-mono text-sm">{program.gradeLevel}</TableCell>
      <TableCell className="text-sm">{program.assessmentTypes.join(', ')}</TableCell>
      <TableCell className="text-sm">{program.scheduledDate ?? '—'}</TableCell>
      <TableCell>
        <span
          className={cn(
            'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
            program.status === 'planned' &&
              'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
            program.status === 'in-progress' &&
              'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
            program.status === 'completed' &&
              'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
          )}
        >
          {program.status}
        </span>
      </TableCell>
    </TableRow>
  );
}

function Kpi({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">{icon}</div>
        <div>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
