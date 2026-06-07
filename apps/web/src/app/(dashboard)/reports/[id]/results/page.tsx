/**
 * Report run results page — list past runs and download outputs.
 *
 * Validates: Requirement 17.1 — download generated report outputs.
 */
import { notFound } from 'next/navigation';
import { Download } from 'lucide-react';

import {
  Badge,
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
  getReportTemplate,
  listReportRuns,
  type ReportRun,
} from '@/lib/api/reports';

interface PageProps {
  params: { id: string };
}

export default async function ReportResultsPage({ params }: PageProps) {
  const [template, runs] = await Promise.all([
    getReportTemplate(params.id),
    listReportRuns(params.id),
  ]);

  if (!template) notFound();

  return (
    <section aria-labelledby="report-runs-heading" className="space-y-6">
      <header>
        <h1 id="report-runs-heading" className="text-2xl font-semibold tracking-tight">
          {template.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {template.description}
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Past runs</CardTitle>
          <CardDescription>
            {runs.length.toLocaleString()} report runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No reports generated for this template yet.
            </p>
          ) : (
            <Table aria-label="Report runs">
              <TableHeader>
                <TableRow>
                  <TableHead>Generated</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-end">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{run.generatedAt}</TableCell>
                    <TableCell>{run.generatedBy}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{run.format}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{run.fileSizeKb} KB</TableCell>
                    <TableCell>
                      <RunStatus status={run.status} />
                    </TableCell>
                    <TableCell className="text-end">
                      {run.downloadUrl && run.status === 'READY' ? (
                        <Button asChild variant="ghost" size="sm">
                          <a href={run.downloadUrl} download>
                            <Download className="me-1 h-4 w-4" aria-hidden="true" />
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

function RunStatus({ status }: { status: ReportRun['status'] }) {
  switch (status) {
    case 'READY':
      return <Badge variant="success">Ready</Badge>;
    case 'FAILED':
      return <Badge variant="destructive">Failed</Badge>;
    case 'RUNNING':
      return <Badge variant="warning">Running</Badge>;
    default:
      return <Badge variant="secondary">Queued</Badge>;
  }
}
