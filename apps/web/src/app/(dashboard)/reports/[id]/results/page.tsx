/**
 * Report run results page — list past runs and download outputs.
 *
 * Validates: Requirement 17.1 — download generated report outputs.
 */
import Link from 'next/link';
import { ArrowLeft, Download, FileBarChart } from 'lucide-react';

import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import {
  getReportTemplate,
  listReportRuns,
  type ReportRun,
} from '@/lib/api/reports';

interface PageProps {
  params: { id: string };
}

export default async function ReportResultsPage({ params }: PageProps) {
  const [templateResult, runsResult] = await Promise.all([
    getReportTemplate(params.id),
    listReportRuns(params.id),
  ]);
  const { template, source: templateSource } = templateResult;
  const { runs, source: runsSource } = runsResult;
  const source =
    templateSource === 'scaffold' || runsSource === 'scaffold'
      ? 'scaffold'
      : 'gateway';

  if (!template) {
    return (
      <section aria-labelledby="report-runs-heading" className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
          <Link href="/reports">
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            Reports
          </Link>
        </Button>
        <div>
          <h1
            id="report-runs-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Report results
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Template unavailable for id{' '}
            <code className="font-mono text-xs">{params.id}</code>.
          </p>
        </div>
        <ScaffoldModeBanner
          source={source}
          force={source === 'scaffold'}
          surface="Report results"
          detail="The reports gateway did not return this template. Showing a stable empty/error state instead of inventing demo runs."
        />
        <Alert variant="warning">
          <AlertTitle>Template not found</AlertTitle>
          <AlertDescription>
            No live template matched this id. Connect the reports service or pick a
            template from the catalog.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const readyRuns = runs.filter((run) => run.status === 'READY').length;

  return (
    <section aria-labelledby="report-runs-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/reports">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Reports
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="report-runs-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            {template.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
        </div>
      </div>

      <ScaffoldModeBanner source={source} surface="Report results" />

      <Card>
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileBarChart className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">{template.name} results</CardTitle>
            <CardDescription>
              {template.module} · {runs.length.toLocaleString()} run
              {runs.length === 1 ? '' : 's'} · {readyRuns.toLocaleString()} ready to
              download
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Total runs</dt>
              <dd className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
                {runs.length.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Ready</dt>
              <dd className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
                {readyRuns.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Output formats</dt>
              <dd className="mt-0.5 text-sm font-semibold text-foreground">
                {template.format.length > 0
                  ? template.format.join(', ')
                  : 'Currently unavailable'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Past runs</CardTitle>
          <CardDescription>Reports generated for this template.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No results yet for this template.
            </p>
          ) : (
            <Table aria-label="Report runs">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Generated</TableHead>
                  <TableHead className="font-semibold">By</TableHead>
                  <TableHead className="font-semibold">Format</TableHead>
                  <TableHead className="text-end font-semibold">Size</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-end font-semibold">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id} className="group">
                    <TableCell className="font-semibold text-foreground">
                      {run.generatedAt}
                    </TableCell>
                    <TableCell>{run.generatedBy}</TableCell>
                    <TableCell className="font-mono text-xs">{run.format}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {run.fileSizeKb} KB
                    </TableCell>
                    <TableCell>
                      <RunStatus status={run.status} />
                    </TableCell>
                    <TableCell className="text-end">
                      {run.downloadUrl && run.status === 'READY' ? (
                        <Button asChild variant="ghost" size="sm">
                          <a href={run.downloadUrl} download>
                            <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
                            Download
                          </a>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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

const STATUS_STYLES: Record<ReportRun['status'], { label: string; className: string }> = {
  READY: {
    label: 'Ready',
    className:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  },
  RUNNING: {
    label: 'Running',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  },
  QUEUED: {
    label: 'Queued',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  },
  FAILED: {
    label: 'Failed',
    className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  },
};

function RunStatus({ status }: { status: ReportRun['status'] }) {
  const { label, className } = STATUS_STYLES[status] ?? STATUS_STYLES.QUEUED;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        className,
      )}
    >
      {label}
    </span>
  );
}
