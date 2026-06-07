/**
 * Report run configuration page.
 *
 * Validates: Requirement 17.1 — configure filters and generate report.
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
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@proctira/ui/components';
import { getReportTemplate, listReportTemplates } from '@/lib/api/reports';
import type { ReportTemplate, ReportFilter } from '@/lib/api/reports';

interface PageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function NewReportPage({ searchParams }: PageProps) {
  const requestedTemplateId = single(searchParams?.templateId);
  const [templates, requestedTemplate] = await Promise.all([
    listReportTemplates(),
    requestedTemplateId ? getReportTemplate(requestedTemplateId) : Promise.resolve(null),
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
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          New report
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a template, set filters, and download once the run completes.
        </p>
      </div>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Template</CardTitle>
        </CardHeader>
        <CardContent>
          <FormField id="report-template" label="Template" required>
            <Select defaultValue={requestedTemplate?.id}>
              <SelectTrigger id="report-template">
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    No templates available
                  </SelectItem>
                ) : (
                  templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </FormField>
        </CardContent>
      </Card>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            {requestedTemplate
              ? `Configure ${requestedTemplate.filters.length} filter fields for ${requestedTemplate.name}.`
              : 'Filters appear when a template is selected.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" noValidate>
            {requestedTemplate ? (
              <FilterFields template={requestedTemplate} />
            ) : (
              <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                Select a template above to configure filters.
              </p>
            )}

            <FormField id="report-format" label="Output format" required>
              <Select defaultValue={requestedTemplate?.format[0] ?? 'PDF'}>
                <SelectTrigger id="report-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(requestedTemplate?.format ?? ['PDF', 'XLSX', 'CSV']).map((fmt) => (
                    <SelectItem key={fmt} value={fmt}>
                      {fmt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <div className="flex justify-end gap-3 pt-2">
              <Button asChild variant="outline" type="button">
                <Link href="/reports">Cancel</Link>
              </Button>
              <Button type="submit">Generate report</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterFields({ template }: { template: ReportTemplate }) {
  if (template.filters.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This template has no filters; output uses default scope.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {template.filters.map((filter) => (
        <FilterControl key={filter.key} filter={filter} />
      ))}
    </div>
  );
}

function FilterControl({ filter }: { filter: ReportFilter }) {
  if (filter.type === 'select') {
    return (
      <FormField id={`filter-${filter.key}`} label={filter.label} required={filter.required}>
        <Select>
          <SelectTrigger id={`filter-${filter.key}`}>
            <SelectValue placeholder={`Select ${filter.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {(filter.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    );
  }
  return (
    <FormField id={`filter-${filter.key}`} label={filter.label} required={filter.required}>
      <Input
        id={`filter-${filter.key}`}
        name={filter.key}
        type={filter.type === 'number' ? 'number' : filter.type === 'date' ? 'date' : 'text'}
      />
    </FormField>
  );
}
