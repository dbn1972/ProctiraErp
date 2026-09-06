/**
 * Data warehouse import page (Server Component shell) — v2.0 redesign.
 *
 * Validates: Requirement 15.1 — Excel/CSV/database import job tracking.
 *
 * Forms validate client-side; submit remains demo-only until the warehouse
 * import API is wired (see ImportSourceForms).
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

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
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';
import { cn } from '@/lib/utils';
import { listImportJobs, type DwImportJob } from '@/lib/api/data-warehouse';

import { ImportSourceForms } from './import-source-forms';

export const dynamic = 'force-dynamic';

const IMPORT_STEPS = ['Source', 'Mapping', 'Validate', 'Run'] as const;

export default async function DataWarehouseImportPage() {
  const jobs = await listImportJobs();

  return (
    <section aria-labelledby="dw-import-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/data-warehouse">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to data warehouse
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="dw-import-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Import data
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bring data into the warehouse from spreadsheets, CSVs, or external databases.
          </p>
        </div>
      </div>

      <ScaffoldModeBanner
        surface="Data warehouse import"
        detail="Upload and database forms validate locally. Successful submits are demo acknowledgements only — no import jobs are queued without a live warehouse API."
      />

      <ImportStepper activeIndex={0} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          After choosing a source, map columns to warehouse fields (not the GIS map).
        </p>
        <Button asChild size="sm">
          <Link href="/data-warehouse/field-mapping">Continue to mapping</Link>
        </Button>
      </div>

      <ImportSourceForms />

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Import history</CardTitle>
          <CardDescription>{jobs.length.toLocaleString()} jobs.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            <p className="border-t py-12 text-center text-sm text-muted-foreground">
              No import jobs yet.
            </p>
          ) : (
            <Table aria-label="Import jobs">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Source</TableHead>
                  <TableHead className="font-semibold">File</TableHead>
                  <TableHead className="font-semibold">Submitted</TableHead>
                  <TableHead className="text-end font-semibold">Rows</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id} className="group">
                    <TableCell>
                      <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                        {job.source}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{job.filename}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {job.submittedAt}
                    </TableCell>
                    <TableCell className="text-end text-sm tabular-nums text-foreground">
                      {job.rows.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <JobStatus status={job.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ImportStepper({ activeIndex }: { activeIndex: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Import progress">
      {IMPORT_STEPS.map((label, index) => {
        const isDone = index < activeIndex;
        const isActive = index === activeIndex;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold',
                  isDone && 'bg-primary text-primary-foreground',
                  isActive && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                  !isDone && !isActive && 'bg-muted text-muted-foreground',
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  'text-sm font-medium',
                  isActive || isDone ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {index < IMPORT_STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={cn('h-px flex-1', isDone ? 'bg-primary' : 'bg-border')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function JobStatus({ status }: { status: DwImportJob['status'] }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold';
  switch (status) {
    case 'SUCCEEDED':
      return (
        <span
          className={cn(
            base,
            'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
          )}
        >
          Succeeded
        </span>
      );
    case 'FAILED':
      return (
        <span className={cn(base, 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400')}>
          Failed
        </span>
      );
    case 'RUNNING':
      return (
        <span
          className={cn(
            base,
            'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
          )}
        >
          Running
        </span>
      );
    default:
      return (
        <span className={cn(base, 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400')}>
          Queued
        </span>
      );
  }
}
