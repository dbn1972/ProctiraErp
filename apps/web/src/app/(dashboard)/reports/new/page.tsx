/**
 * Report run configuration page.
 *
 * Layout per redesign/web/reports-new.html:
 *  - Template + filters form
 *  - Output format selection
 *  - Note which analytical report types the gateway data source supports
 *
 * Validates: Requirement 17.1 — configure filters and generate report.
 */
import Link from 'next/link';
import { ArrowLeft, Info } from 'lucide-react';

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

export const dynamic = 'force-dynamic';

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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            New report
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a template, set filters, and download once the run completes.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/reports">Cancel</Link>
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Supported analytical types</AlertTitle>
        <AlertDescription>
          Enrollment, students, attendance summary, examination results, and
          scholarship applications/utilization. Other types return empty rows.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Report builder</CardTitle>
              <CardDescription>
                Choose what to report and how to scope the output.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" noValidate>
                <FormField id="report-template" label="Report type" required>
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

                {requestedTemplate ? (
                  <FilterFields template={requestedTemplate} />
                ) : (
                  <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                    Select a template to configure filters.
                  </p>
                )}

                <FormField id="report-format" label="Output format" required>
                  <Select defaultValue={requestedTemplate?.format[0] ?? 'PDF'}>
                    <SelectTrigger id="report-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(requestedTemplate?.format ?? ['PDF', 'XLSX', 'CSV']).map(
                        (fmt) => (
                          <SelectItem key={fmt} value={fmt}>
                            {fmt}
                          </SelectItem>
                        ),
                      )}
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

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <CardDescription>
              A live preview will appear here once report generation is wired.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-10 text-center text-xs text-muted-foreground">
              {requestedTemplate
                ? `Preview for ${requestedTemplate.name}`
                : 'Select a template to preview scope'}
            </div>
          </CardContent>
        </Card>
      </div>
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
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Filters
      </p>
      {template.filters.map((filter) => (
        <FilterControl key={filter.key} filter={filter} />
      ))}
    </div>
  );
}

function FilterControl({ filter }: { filter: ReportFilter }) {
  if (filter.type === 'select') {
    return (
      <FormField
        id={`filter-${filter.key}`}
        label={filter.label}
        required={filter.required}
      >
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
    <FormField
      id={`filter-${filter.key}`}
      label={filter.label}
      required={filter.required}
    >
      <Input
        id={`filter-${filter.key}`}
        name={filter.key}
        type={
          filter.type === 'number'
            ? 'number'
            : filter.type === 'date'
              ? 'date'
              : 'text'
        }
      />
    </FormField>
  );
}
