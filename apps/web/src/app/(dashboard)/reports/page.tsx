/**
 * Report templates list (Server Component).
 *
 * Validates: Requirement 17.1 — discover and run report templates.
 */
import Link from 'next/link';
import { FileBarChart, Plus } from 'lucide-react';

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
import { listReportTemplates, type ReportTemplate } from '@/lib/api/reports';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const templates = await listReportTemplates();

  return (
    <section aria-labelledby="reports-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="reports-heading" className="text-2xl font-semibold tracking-tight">
            Reports
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure filters and generate reports across modules.
          </p>
        </div>
        <Button asChild>
          <Link href="/reports/new">
            <Plus className="me-2 h-4 w-4" aria-hidden="true" />
            New report
          </Link>
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Templates</CardTitle>
          <CardDescription>
            {templates.length.toLocaleString()} report templates available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <EmptyState />
          ) : (
            <TemplatesTable items={templates} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
      <FileBarChart className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">No report templates</p>
      <p className="text-sm text-muted-foreground">
        Add a template to enable repeatable report generation.
      </p>
    </div>
  );
}

function TemplatesTable({ items }: { items: ReportTemplate[] }) {
  return (
    <Table aria-label="Report templates">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Module</TableHead>
          <TableHead>Formats</TableHead>
          <TableHead>Filters</TableHead>
          <TableHead className="text-end">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((tpl) => (
          <TableRow key={tpl.id}>
            <TableCell>
              <p className="font-medium">{tpl.name}</p>
              <p className="text-xs text-muted-foreground">{tpl.description}</p>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{tpl.module}</Badge>
            </TableCell>
            <TableCell className="space-x-1">
              {tpl.format.map((fmt) => (
                <Badge key={fmt} variant="secondary">
                  {fmt}
                </Badge>
              ))}
            </TableCell>
            <TableCell>{tpl.filters.length} fields</TableCell>
            <TableCell className="text-end">
              <div className="flex justify-end gap-2">
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/reports/${tpl.id}/results`}>Results</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href={`/reports/new?templateId=${tpl.id}`}>Run</Link>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
