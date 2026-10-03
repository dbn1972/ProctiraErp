'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, FormField, Input, Textarea } from '@proctira/ui/components';
import type { EtlConnection } from '@/lib/api/etl';
import { createPipelineAction } from '../actions';

const MAX_CSV_BYTES = 1024 * 1024;
const selectClass = 'min-h-11 rounded-md border border-input bg-background px-3 text-sm';

/**
 * PRC-M109: real source config + a server-managed destination connection.
 * New pipelines start disabled unless the user opts in.
 */
export function CreatePipelineForm({ connections }: { connections: EtlConnection[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<'csv' | 'rest_api'>('csv');
  const [pending, startTransition] = useTransition();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    setError(null);
    setMessage(null);
    let csvContent = String(fd.get('csvText') ?? '');
    const file = fd.get('csvFile');
    if (sourceType === 'csv' && file instanceof File && file.size > 0) {
      if (file.size > MAX_CSV_BYTES) {
        setError('CSV must be 1 MB or smaller.');
        return;
      }
      csvContent = await file.text();
    }
    startTransition(async () => {
      const result = await createPipelineAction({
        name: String(fd.get('name') ?? ''),
        description: String(fd.get('description') ?? ''),
        sourceType,
        csvContent: sourceType === 'csv' ? csvContent : undefined,
        restUrl: sourceType === 'rest_api' ? String(fd.get('restUrl') ?? '') : undefined,
        connectionId: String(fd.get('connectionId') ?? ''),
        table: String(fd.get('table') ?? ''),
        mappings: String(fd.get('mappings') ?? ''),
        enabled: fd.get('enabled') === 'on',
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create pipeline');
        return;
      }
      form.reset();
      setMessage('Pipeline created.');
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 sm:grid-cols-2"
      data-testid="create-pipeline-form"
    >
      <FormField label="Pipeline name" htmlFor="pipeline-name">
        <Input id="pipeline-name" name="name" required maxLength={255} className="min-h-11" />
      </FormField>
      <FormField label="Description (optional)" htmlFor="pipeline-description">
        <Input id="pipeline-description" name="description" maxLength={1000} className="min-h-11" />
      </FormField>
      <FormField label="Source" htmlFor="sourceType">
        <select
          id="sourceType"
          name="sourceType"
          className={selectClass}
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value as 'csv' | 'rest_api')}
        >
          <option value="csv">CSV</option>
          <option value="rest_api">REST API (GET)</option>
        </select>
      </FormField>
      {sourceType === 'csv' ? (
        <div className="space-y-3 sm:col-span-2">
          <FormField
            label="CSV file (first row is the header, max 1 MB)"
            htmlFor="pipeline-csv-file"
          >
            <Input
              id="pipeline-csv-file"
              name="csvFile"
              type="file"
              accept=".csv,text/csv"
              className="min-h-11"
            />
          </FormField>
          <FormField label="…or paste CSV" htmlFor="pipeline-csv-text">
            <Textarea id="pipeline-csv-text" name="csvText" rows={4} />
          </FormField>
        </div>
      ) : (
        <FormField label="Source URL (https)" htmlFor="pipeline-rest-url">
          <Input
            id="pipeline-rest-url"
            name="restUrl"
            type="url"
            inputMode="url"
            required
            placeholder="https://"
            className="min-h-11"
          />
        </FormField>
      )}
      <FormField label="Destination connection" htmlFor="pipeline-connection">
        <select
          id="pipeline-connection"
          name="connectionId"
          required
          className={selectClass}
          defaultValue=""
        >
          <option value="" disabled>
            Choose a connection
          </option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Destination table" htmlFor="pipeline-table">
        <Input id="pipeline-table" name="table" required maxLength={63} className="min-h-11" />
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          label="Field mappings (one per line: source_field -> destination_column)"
          htmlFor="pipeline-mappings"
        >
          <Textarea id="pipeline-mappings" name="mappings" required rows={3} />
        </FormField>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="enabled" className="h-4 w-4" />
        Enable immediately (off by default; review the pipeline first)
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending} className="min-h-11">
          {pending ? 'Creating…' : 'Create pipeline'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-muted-foreground sm:col-span-2">
          {message}
        </p>
      ) : null}
    </form>
  );
}
