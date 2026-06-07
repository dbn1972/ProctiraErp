/**
 * Scholarship programs list (Server Component).
 *
 * Validates: Requirement 11.1 — scholarship program management entry point.
 */
import Link from 'next/link';
import { Award, Eye, FileText, MoreVertical, Pencil, Plus, Wallet } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  listScholarshipPrograms,
  type ScholarshipProgram,
} from '@/lib/api/scholarships';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<ScholarshipProgram['status'], string> = {
  DRAFT: 'Draft',
  OPEN: 'Window open',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
};

const STATUS_COLOURS: Record<ScholarshipProgram['status'], string> = {
  OPEN: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  DRAFT: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  CLOSED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  ARCHIVED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

export default async function ScholarshipsPage() {
  const programs = await listScholarshipPrograms();
  const openCount = programs.filter((program) => program.status === 'OPEN').length;

  return (
    <section aria-labelledby="programs-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="programs-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Scholarship programs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Central and state scholarship schemes — eligibility, application windows, and DBT
            disbursements in one place.
            {programs.length > 0
              ? ` ${programs.length.toLocaleString()} programs configured, ${openCount.toLocaleString()} with an open window.`
              : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/scholarships/applications">
              <FileText className="me-1.5 h-4 w-4" aria-hidden="true" />
              Applications
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/scholarships/disbursements">
              <Wallet className="me-1.5 h-4 w-4" aria-hidden="true" />
              Disbursements
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/scholarships/programs/new">
              <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
              New program
            </Link>
          </Button>
        </div>
      </div>

      {programs.length === 0 ? (
        <EmptyState />
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <ProgramsTable items={programs} />
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              Showing <span className="font-semibold text-foreground">1–{programs.length}</span> of{' '}
              <span className="font-semibold text-foreground">{programs.length}</span> programs
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Award className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-base font-medium">No scholarship programs yet</p>
        <p className="text-sm text-muted-foreground">
          Create your first scholarship program to start accepting applications.
        </p>
        <Button asChild className="mt-2">
          <Link href="/scholarships/programs/new">Create program</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ProgramsTable({ items }: { items: ScholarshipProgram[] }) {
  return (
    <Table aria-label="Scholarship programs">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="font-semibold">Program</TableHead>
          <TableHead className="font-semibold text-end">Slots</TableHead>
          <TableHead className="font-semibold text-end">Award</TableHead>
          <TableHead className="font-semibold">Application window</TableHead>
          <TableHead className="font-semibold">Status</TableHead>
          <TableHead className="font-semibold text-end">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((program) => (
          <TableRow key={program.id} className="group">
            <TableCell>
              <Link
                href={`/scholarships/programs/${program.id}`}
                className="font-semibold text-foreground hover:underline"
              >
                {program.name}
              </Link>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-mono">{program.code}</span>
              </p>
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {program.totalSlots.toLocaleString()}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {program.currency} {program.awardAmount.toLocaleString()}
            </TableCell>
            <TableCell>
              {program.applicationStartDate} → {program.applicationEndDate}
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  STATUS_COLOURS[program.status],
                )}
              >
                {STATUS_LABELS[program.status]}
              </span>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                <Button asChild variant="ghost" size="icon" className="h-8 w-8 p-0">
                  <Link href={`/scholarships/programs/${program.id}`} aria-label="View">
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="Edit">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 p-0" aria-label="More">
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
