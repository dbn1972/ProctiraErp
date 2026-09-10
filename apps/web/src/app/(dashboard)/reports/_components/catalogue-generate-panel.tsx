'use client';

import { useState, useTransition } from 'react';
import { Download } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/hooks/useHydrated';
import type { ReportFormat, ReportTemplate } from '@/lib/api/reports';

import { generateReportAction } from '../actions';

const selectClassName = cn(
  'flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2',
  'text-sm text-foreground shadow-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
);

interface CatalogueGeneratePanelProps {
  templates: ReportTemplate[];
}

export function CatalogueGeneratePanel({ templates }: CatalogueGeneratePanelProps) {
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [sha256, setSha256] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '');

  const selected = templates.find((tpl) => tpl.id === selectedId) ?? templates[0] ?? null;
  const formats: ReportFormat[] = selected?.format ?? ['CSV', 'XLSX', 'PDF'];

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const templateId = String(form.get('templateId') ?? '').trim();
    const format = String(form.get('format') ?? 'CSV') as ReportFormat;
    if (!templateId) {
      setError('Select a catalogue report.');
      return;
    }
    startTransition(async () => {
      const result = await generateReportAction({ templateId, format });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to generate');
        return;
      }
      setArtifactId(result.artifactId ?? null);
      setSha256(result.sha256 ?? null);
    });
  }

  return (
    <form
      className="space-y-4"
      data-testid="report-generate-form"
      data-hydrated={hydrated ? 'true' : 'false'}
      onSubmit={onSubmit}
      noValidate
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate export</CardTitle>
          <CardDescription>
            CSV, XLSX, or PDF. The downloaded file hash must match the stored artifact.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField id="generate-template" label="Report" required>
            <select
              id="generate-template"
              name="templateId"
              className={selectClassName}
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="generate-format" label="Format" required>
            <select
              id="generate-format"
              name="format"
              className={selectClassName}
              defaultValue="CSV"
            >
              {formats.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {fmt}
                </option>
              ))}
            </select>
          </FormField>
          {error && (
            <p className="sm:col-span-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {artifactId && (
            <div
              className="sm:col-span-2 space-y-2 rounded-md border border-border p-3"
              data-testid="report-artifact"
              data-artifact-id={artifactId}
            >
              <p className="font-mono text-xs break-all" data-testid="report-artifact-sha256">
                {sha256}
              </p>
              <Button asChild size="sm" variant="secondary">
                <a
                  href={`/api/reports/artifacts/${artifactId}/download`}
                  download
                  data-testid="report-artifact-download"
                >
                  <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
                  Download
                </a>
              </Button>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button
              type="submit"
              className="min-h-11"
              disabled={pending}
              title={pending ? 'Generating report' : undefined}
            >
              {pending ? 'Generating…' : 'Generate'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
