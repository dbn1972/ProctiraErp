/**
 * Data warehouse import page (Server Component shell).
 *
 * Validates: Requirement 15.1 — Excel/CSV/database import job tracking.
 */
import { Database, FileSpreadsheet, FileText } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { listImportJobs, type DwImportJob } from '@/lib/api/data-warehouse';

export const dynamic = 'force-dynamic';

export default async function DataWarehouseImportPage() {
  const jobs = await listImportJobs();

  return (
    <section aria-labelledby="dw-import-heading" className="space-y-6">
      <header>
        <h1 id="dw-import-heading" className="text-2xl font-semibold tracking-tight">
          Import data
        </h1>
        <p className="text-sm text-muted-foreground">
          Bring data into the warehouse from spreadsheets, CSVs, or external databases.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <ImportSourceCard
          icon={<FileSpreadsheet className="h-6 w-6" aria-hidden="true" />}
          title="Excel"
          description="Upload an .xlsx workbook (max 50 MB)."
          accept=".xlsx,.xls"
        />
        <ImportSourceCard
          icon={<FileText className="h-6 w-6" aria-hidden="true" />}
          title="CSV"
          description="Upload a .csv file with a header row."
          accept=".csv"
        />
        <DatabaseImportCard />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Import history</CardTitle>
          <CardDescription>{jobs.length.toLocaleString()} jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No import jobs yet.
            </p>
          ) : (
            <Table aria-label="Import jobs">
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Badge variant="outline">{job.source}</Badge>
                    </TableCell>
                    <TableCell>{job.filename}</TableCell>
                    <TableCell>{job.submittedAt}</TableCell>
                    <TableCell className="text-right">{job.rows.toLocaleString()}</TableCell>
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

function ImportSourceCard({
  icon,
  title,
  description,
  accept,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accept: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" encType="multipart/form-data">
          <Input type="file" accept={accept} aria-label={`Upload ${title} file`} />
          <Button type="submit" size="sm">
            Upload
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DatabaseImportCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Database className="h-6 w-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-base">Database</CardTitle>
        </div>
        <CardDescription>Pull data from an external database connection.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3">
          <FormField id="db-conn" label="Connection string" required>
            <Input id="db-conn" name="connection" placeholder="postgres://…" />
          </FormField>
          <Button type="submit" size="sm">
            Import
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function JobStatus({ status }: { status: DwImportJob['status'] }) {
  switch (status) {
    case 'SUCCEEDED':
      return <Badge variant="success">Succeeded</Badge>;
    case 'FAILED':
      return <Badge variant="destructive">Failed</Badge>;
    case 'RUNNING':
      return <Badge variant="warning">Running</Badge>;
    default:
      return <Badge variant="secondary">Queued</Badge>;
  }
}
