/**
 * Report schedules — cadence CRUD (G-909).
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
import { listReportRuns, listReportSchedules, listReportTemplates } from '@/lib/reports/api';

import { ReportScheduleForm } from './schedule-form';
import { RunDueButton, ScheduleRowActions } from './schedule-actions';

export const dynamic = 'force-dynamic';

export default async function ReportSchedulesPage() {
  const [{ schedules, source }, { templates }, { runs }] = await Promise.all([
    listReportSchedules(),
    listReportTemplates(),
    listReportRuns(),
  ]);

  return (
    <section aria-labelledby="report-schedules-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/reports">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Reports
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="report-schedules-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Report schedules
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily, weekly, or monthly runs with an hour and recipients. Due ticks record
            trigger=schedule in run history.
          </p>
        </div>
        <RunDueButton />
      </div>

      <ScaffoldModeBanner source={source} surface="Report schedules" />

      <ReportScheduleForm templates={templates} />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Scheduled jobs</CardTitle>
          <CardDescription>
            {schedules.length.toLocaleString()} schedule{schedules.length === 1 ? '' : 's'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {schedules.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No schedules yet. Create one above.
            </p>
          ) : (
            <Table aria-label="Report schedules">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead>Report</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Hour UTC</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((row) => (
                  <TableRow key={row.id} data-testid="report-schedule-row">
                    <TableCell className="font-medium">{row.reportKey}</TableCell>
                    <TableCell>{row.cadence}</TableCell>
                    <TableCell className="tabular-nums">{row.hour}</TableCell>
                    <TableCell className="text-xs">{row.nextRunAt}</TableCell>
                    <TableCell>{row.enabled ? 'Yes' : 'Paused'}</TableCell>
                    <TableCell className="text-end">
                      <ScheduleRowActions scheduleId={row.id} enabled={row.enabled} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Run history</CardTitle>
          <CardDescription>Manual and scheduled catalogue runs for this tenant.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <Table aria-label="Report run history">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead>When</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="font-mono text-xs">SHA-256</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id} data-testid="report-run-row" data-trigger={run.trigger ?? 'manual'}>
                    <TableCell className="text-xs">{run.generatedAt}</TableCell>
                    <TableCell>{run.templateName}</TableCell>
                    <TableCell>{run.trigger ?? 'manual'}</TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell className="max-w-[12rem] truncate font-mono text-[11px]">
                      {run.sha256 ?? '—'}
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
