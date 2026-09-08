/**
 * Report run configuration page.
 *
 * Validates: Requirement 17.1 — configure filters and generate report.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { getReportTemplate, listReportTemplates } from '@/lib/api/reports';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';

import { ReportBuilderForm } from './report-builder-form';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function NewReportPage({ searchParams }: PageProps) {
  const requestedTemplateId = single(searchParams?.templateId);
  const [{ templates, source }, requested] = await Promise.all([
    listReportTemplates(),
    requestedTemplateId
      ? getReportTemplate(requestedTemplateId)
      : Promise.resolve({ template: null, source: 'scaffold' as const }),
  ]);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/reports">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Reports
        </Link>
      </Button>

      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">New report</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a template, set filters, and download once the run completes.
        </p>
      </div>

      <ScaffoldModeBanner
        source={source}
        force={source === 'scaffold'}
        surface="Report builder"
        detail="Builder UI validates locally. When the gateway responds with templates, generate posts to POST /reports/generate."
      />

      <ReportBuilderForm
        templates={templates}
        requestedTemplate={requested.template}
        liveGenerate={source === 'gateway'}
      />

      {/* Keep source in the DOM for diagnostics without implying live generate. */}
      <span className="sr-only" data-insights-source={source}>
        templates source {source}
      </span>
    </div>
  );
}
