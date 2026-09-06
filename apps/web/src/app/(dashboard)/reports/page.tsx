/**
 * Report templates list (Server Component).
 *
 * Validates: Requirement 17.1 — discover and run report templates.
 */
import Link from 'next/link';
import { FileBarChart, Plus, Play } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardContent,
} from '@proctira/ui/components';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';
import { listReportTemplates, type ReportTemplate } from '@/lib/api/reports';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const { templates, source } = await listReportTemplates();

  const grouped = groupByModule(templates);
  const moduleCount = grouped.length;

  return (
    <section aria-labelledby="reports-heading" className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="reports-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {templates.length.toLocaleString()} ready-made report
            {templates.length === 1 ? '' : 's'}
            {moduleCount > 0
              ? ` across ${moduleCount.toLocaleString()} module${moduleCount === 1 ? '' : 's'}`
              : ''}{' '}
            — or build your own.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/reports/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New report
          </Link>
        </Button>
      </div>

      <ScaffoldModeBanner
        source={source}
        surface="Reports catalog"
        detail={
          templates.length === 0
            ? 'No report templates loaded from the gateway. The empty catalog is expected until the reports service is reachable — this is not a production failure silent-hide.'
            : 'Templates listed here come from the reports gateway when connected; otherwise the catalog stays empty rather than inventing fixtures.'
        }
      />

      {templates.length === 0 ? (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <EmptyState />
          </CardContent>
        </Card>
      ) : (
        grouped.map(({ module, items }) => (
          <section key={module} aria-label={module} className="space-y-3">
            <h2 className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <span>{module}</span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((tpl) => (
                <ReportCard key={tpl.id} template={tpl} />
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}

function groupByModule(
  templates: ReportTemplate[],
): Array<{ module: string; items: ReportTemplate[] }> {
  const map = new Map<string, ReportTemplate[]>();
  for (const tpl of templates) {
    const key = tpl.module || 'Other';
    const list = map.get(key);
    if (list) list.push(tpl);
    else map.set(key, [tpl]);
  }
  return Array.from(map.entries()).map(([module, items]) => ({ module, items }));
}

function ReportCard({ template }: { template: ReportTemplate }) {
  return (
    <Card className="group flex flex-col p-5 transition-shadow hover:shadow-md">
      <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FileBarChart className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="text-base font-bold tracking-tight text-foreground">
        <Link
          href={`/reports/${template.id}/results`}
          className="hover:underline"
        >
          {template.name}
        </Link>
      </h3>
      <p className="mt-1 flex-1 text-xs text-muted-foreground">
        {template.description}
      </p>
      <div className="mt-3 flex flex-wrap gap-1">
        {template.format.map((fmt) => (
          <Badge key={fmt} variant="secondary">
            {fmt}
          </Badge>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {template.filters.length.toLocaleString()} filter
          {template.filters.length === 1 ? '' : 's'}
        </span>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/reports/new?templateId=${template.id}`}>
            <Play className="me-1.5 h-4 w-4" aria-hidden="true" />
            Run
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <FileBarChart className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">No report templates</p>
      <p className="text-sm text-muted-foreground">
        Add a template to enable repeatable report generation.
      </p>
    </div>
  );
}
