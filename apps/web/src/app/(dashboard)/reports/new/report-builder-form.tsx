'use client';

import { useState } from 'react';
import Link from 'next/link';

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
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import type { ReportTemplate, ReportFilter } from '@/lib/api/reports';

interface ReportBuilderFormProps {
  templates: ReportTemplate[];
  requestedTemplate: ReportTemplate | null;
}

const selectClassName = cn(
  'flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2',
  'text-sm text-foreground shadow-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/**
 * Report builder with client-side validation.
 * Generate remains demo-only until the reports run API is wired.
 */
export function ReportBuilderForm({
  templates,
  requestedTemplate,
}: ReportBuilderFormProps) {
  const [selectedId, setSelectedId] = useState(requestedTemplate?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  const selected =
    templates.find((tpl) => tpl.id === selectedId) ??
    (requestedTemplate?.id === selectedId ? requestedTemplate : null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDemoMessage(null);

    const form = new FormData(event.currentTarget);
    const templateId = String(form.get('templateId') ?? '').trim();
    if (!templateId || templateId === '__none') {
      setError('Select a report template before generating.');
      return;
    }

    const format = String(form.get('report-format') ?? '').trim();
    if (!format) {
      setError('Choose an output format.');
      return;
    }

    if (selected) {
      for (const filter of selected.filters) {
        if (!filter.required) continue;
        const value = String(form.get(filter.key) ?? '').trim();
        if (!value) {
          setError(`${filter.label} is required.`);
          return;
        }
      }
    }

    setDemoMessage(
      'Demo only — report generation is not wired to a live reports service. Filters were validated locally.',
    );
  }

  return (
    <form
      className="space-y-6"
      aria-label="Report builder form"
      data-testid="report-builder-form"
      onSubmit={onSubmit}
      noValidate
    >
      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Template</CardTitle>
        </CardHeader>
        <CardContent>
          <FormField id="report-template" label="Template" required>
            <select
              id="report-template"
              name="templateId"
              className={selectClassName}
              value={selectedId}
              aria-invalid={Boolean(error && !selectedId)}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setError(null);
                setDemoMessage(null);
              }}
            >
              <option value="">Select a template</option>
              {templates.length === 0 ? (
                <option value="__none" disabled>
                  No templates available
                </option>
              ) : (
                templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))
              )}
            </select>
          </FormField>
        </CardContent>
      </Card>

      <Card className="max-w-[860px]">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            {selected
              ? `Configure ${selected.filters.length} filter fields for ${selected.name}.`
              : 'Filters appear when a template is selected.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {selected ? (
            <FilterFields template={selected} />
          ) : (
            <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              Select a template above to configure filters.
            </p>
          )}

          <FormField id="report-format" label="Output format" required>
            <select
              id="report-format"
              name="report-format"
              className={selectClassName}
              defaultValue={selected?.format[0] ?? 'PDF'}
            >
              {(selected?.format ?? ['PDF', 'XLSX', 'CSV']).map((fmt) => (
                <option key={fmt} value={fmt}>
                  {fmt}
                </option>
              ))}
            </select>
          </FormField>

          {error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="report-builder-error"
            >
              {error}
            </p>
          )}
          {demoMessage && (
            <Alert variant="warning" data-testid="report-builder-demo-submit">
              <AlertTitle>Demo generate</AlertTitle>
              <AlertDescription>{demoMessage}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button asChild variant="outline" type="button">
              <Link href="/reports">Cancel</Link>
            </Button>
            <Button type="submit">Generate report</Button>
          </div>
        </CardContent>
      </Card>
    </form>
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
        <select
          id={`filter-${filter.key}`}
          name={filter.key}
          className={selectClassName}
          defaultValue=""
          aria-label={filter.label}
        >
          <option value="">{`Select ${filter.label.toLowerCase()}`}</option>
          {(filter.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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
