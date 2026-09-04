/**
 * /assessments/report-cards — Templates + job lookup.
 *
 * v2.0 redesign + assessment list patterns (no dedicated report-cards HTML
 * in redesign/). Wires GET /api/v1/report-cards/templates and
 * GET /api/v1/report-cards/jobs/:jobId.
 */
import Link from 'next/link';
import { ArrowLeft, FileText, Plus, Search } from 'lucide-react';

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
import {
  getReportCardJob,
  listReportCardTemplates,
  type ReportCardJob,
} from '@/lib/api/report-cards';
import { cn } from '@/lib/utils';

import { ReportCardTemplateForm } from './_components/template-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function readStr(
  params: PageProps['searchParams'],
  key: string,
  fallback = '',
): string {
  if (!params) return fallback;
  const v = params[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return v[0] ?? fallback;
  return fallback;
}

const STATUS_PILL: Record<ReportCardJob['status'], string> = {
  queued: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  processing:
    'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
  completed:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
};

export default async function ReportCardsPage({ searchParams }: PageProps) {
  const jobId = readStr(searchParams, 'jobId');
  const [templates, job] = await Promise.all([
    listReportCardTemplates(),
    jobId ? getReportCardJob(jobId) : Promise.resolve(null),
  ]);

  return (
    <section aria-labelledby="report-cards-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/assessments">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to assessments
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="report-cards-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Report cards
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {templates.length.toLocaleString()} template
            {templates.length === 1 ? '' : 's'} · queue PDF generation and
            track jobs
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/assessments/report-cards/generate">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            Generate
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Templates</CardTitle>
            <CardDescription>
              Configurable layouts for term and annual report cards
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {templates.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <FileText
                  className="h-10 w-10 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-base font-semibold">No templates yet</p>
                <p className="text-sm text-muted-foreground">
                  Create a template on the right to start generating report
                  cards.
                </p>
              </div>
            ) : (
              <Table aria-label="Report card templates">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-semibold">Template</TableHead>
                    <TableHead className="font-semibold">Includes</TableHead>
                    <TableHead className="font-semibold">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((tpl) => (
                    <TableRow key={tpl.id}>
                      <TableCell>
                        <p className="font-semibold text-foreground">
                          {tpl.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {tpl.isDefault ? 'Default · ' : ''}
                          <span className="font-mono">{tpl.id.slice(0, 8)}…</span>
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[
                          tpl.includeLogo ? 'Logo' : null,
                          tpl.includeGradeSummary ? 'Grades' : null,
                          tpl.includeComments ? 'Comments' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(tpl.updatedAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New template</CardTitle>
            <CardDescription>
              HTML / Handlebars content for PDF generation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReportCardTemplateForm />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Job status</CardTitle>
          <CardDescription>
            Look up a generation job by ID (
            <code className="text-xs">GET /report-cards/jobs/:jobId</code>)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <label
                htmlFor="jobId"
                className="text-sm font-medium text-foreground"
              >
                Job ID
              </label>
              <input
                id="jobId"
                name="jobId"
                defaultValue={jobId}
                placeholder="UUID"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button type="submit" size="sm" variant="outline">
              <Search className="me-1.5 h-4 w-4" aria-hidden="true" />
              Look up
            </Button>
          </form>

          {jobId && !job ? (
            <p className="text-sm text-muted-foreground" role="status">
              No job found for that ID.
            </p>
          ) : null}

          {job ? <JobDetail job={job} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}

function JobDetail({ job }: { job: ReportCardJob }) {
  return (
    <dl className="grid gap-3 rounded-md border border-border bg-muted/20 p-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Status
        </dt>
        <dd className="mt-1">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
              STATUS_PILL[job.status],
            )}
          >
            {job.status}
          </span>
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Job ID
        </dt>
        <dd className="mt-1 break-all font-mono text-xs">{job.id}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Student
        </dt>
        <dd className="mt-1 break-all font-mono text-xs">{job.studentId}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Template
        </dt>
        <dd className="mt-1 break-all font-mono text-xs">{job.templateId}</dd>
      </div>
      {job.outputUrl ? (
        <div className="sm:col-span-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Output
          </dt>
          <dd className="mt-1 break-all text-xs">
            <a
              href={job.outputUrl}
              className="text-primary underline-offset-2 hover:underline"
            >
              {job.outputUrl}
            </a>
          </dd>
        </div>
      ) : null}
      {job.errorMessage ? (
        <div className="sm:col-span-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Error
          </dt>
          <dd className="mt-1 text-xs text-destructive">{job.errorMessage}</dd>
        </div>
      ) : null}
    </dl>
  );
}
