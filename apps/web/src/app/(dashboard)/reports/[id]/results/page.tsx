/**
 * Report run results page — list past runs and download outputs.
 *
 * Layout per redesign/web/reports-results.html:
 *  - Status pill + Re-run / Download actions
 *  - Summary KPIs from run metadata (not inventing row data)
 *  - Past runs table
 *
 * Validates: Requirement 17.1 — download generated report outputs.
 * Analytical ReportDataSource is wired for common school report types.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  FileBarChart,
  RefreshCw,
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
import { cn } from '@/lib/utils';
import {
  getReportTemplate,
  listReportRuns,
  type ReportRun,
} from '@/lib/api/reports';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function ReportResultsPage({ params }: PageProps) {
  const [template, runs] = await Promise.all([
    getReportTemplate(params.id),
    listReportRuns(params.id),
  ]);

  if (!template) notFound();

  const readyRuns = runs.filter((run) => run.status === 'READY');
  const latestReady = readyRuns[0] ?? null;
  const latestRun = runs[0] ?? null;

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
          <div className="flex flex-wrap items-center gap-2">
            <h1
              id="report-runs-heading"
              className="text-3xl font-extrabold tracking-tight text-foreground"
            >
              {template.name}
            </h1>
            {latestRun ? <RunStatus status={latestRun.status} /> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {latestRun
              ? `Last run ${latestRun.generatedAt} · by ${latestRun.generatedBy}`
              : template.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/reports/new?templateId=${template.id}`}>
              <RefreshCw className="me-1.5 h-4 w-4" aria-hidden="true" />
              Re-run
            </Link>
          </Button>
          {latestReady?.downloadUrl ? (
            <Button asChild size="sm">
              <a href={latestReady.downloadUrl} download>
                <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
                Download {latestReady.format}
              </a>
            </Button>
          ) : (
            <Button size="sm" type="button" disabled>
              <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
              Download
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Total runs" value={runs.length.toLocaleString()} />
        <KpiCard
          label="Ready to download"
          value={readyRuns.length.toLocaleString()}
        />
        <KpiCard
          label="Output formats"
          value={
            template.format.length > 0
              ? template.format.join(', ')
              : 'Currently unavailable'
          }
          compact
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileBarChart className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Past runs</CardTitle>
              <CardDescription>
                {template.module} · reports generated for this template.
                Rows populate when the template type matches a wired data source.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No results yet for this template.{' '}
              <Link
                href={`/reports/new?templateId=${template.id}`}
                className="font-medium text-primary hover:underline"
              >
                Run it now
              </Link>
              .
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
                    <TableCell className="font-mono text-xs">
                      {run.format}
                    </TableCell>
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
                            <Download
                              className="me-1.5 h-4 w-4"
                              aria-hidden="true"
                            />
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

function KpiCard({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-1 font-extrabold text-foreground',
            compact ? 'text-lg' : 'text-3xl tabular-nums',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

const STATUS_STYLES: Record<
  ReportRun['status'],
  { label: string; className: string }
> = {
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
