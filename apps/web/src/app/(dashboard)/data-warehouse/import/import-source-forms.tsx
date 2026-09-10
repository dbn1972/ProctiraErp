'use client';

import { useState, useTransition } from 'react';
import { Database, FileSpreadsheet, FileText } from 'lucide-react';

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

import { useHydrated } from '@/hooks/useHydrated';

import { createImportJobAction } from '../../reports/actions';

/**
 * Import source forms with client-side validation.
 * When `liveImport` is true, queues jobs via POST /data-warehouse/import/jobs.
 */
export function ImportSourceForms({ liveImport = false }: { liveImport?: boolean }) {
  const hydrated = useHydrated();
  return (
    <div
      className="grid gap-4 md:grid-cols-3"
      data-testid="import-source-forms"
      data-live-import={liveImport ? 'true' : 'false'}
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <FileImportCard
        icon={<FileSpreadsheet className="h-6 w-6" aria-hidden="true" />}
        title="Excel"
        description="Upload an .xlsx workbook (max 50 MB)."
        accept=".xlsx,.xls"
        source="EXCEL"
        liveImport={liveImport}
      />
      <FileImportCard
        icon={<FileText className="h-6 w-6" aria-hidden="true" />}
        title="CSV"
        description="Upload a .csv file with a header row."
        accept=".csv"
        source="CSV"
        liveImport={liveImport}
      />
      <DatabaseImportCard liveImport={liveImport} />
    </div>
  );
}

function FileImportCard({
  icon,
  title,
  description,
  accept,
  source,
  liveImport,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accept: string;
  source: 'EXCEL' | 'CSV';
  liveImport: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const form = event.currentTarget;
    const input = form.elements.namedItem('file') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      setError(`Choose a ${title} file before uploading.`);
      return;
    }

    if (!liveImport) {
      setMessage(
        `Demo only — “${file.name}” was validated locally. No import job was queued (warehouse API not connected).`,
      );
      return;
    }

    startTransition(async () => {
      const result = await createImportJobAction({
        source,
        filename: file.name,
        rows: 0,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to queue import');
        return;
      }
      setMessage(result.message ?? `Import job ${result.id} queued.`);
    });
  }

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
        <form className="space-y-3" encType="multipart/form-data" onSubmit={onSubmit} noValidate>
          <Input
            type="file"
            name="file"
            accept={accept}
            aria-label={`Upload ${title} file`}
            aria-invalid={Boolean(error)}
            onChange={() => {
              setError(null);
              setMessage(null);
            }}
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {message && (
            <Alert
              variant={liveImport ? 'default' : 'warning'}
              data-testid={
                liveImport
                  ? `${title.toLowerCase()}-live-submit`
                  : `${title.toLowerCase()}-demo-submit`
              }
            >
              <AlertTitle>{liveImport ? 'Import queued' : 'Demo submit'}</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Uploading…' : 'Upload'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DatabaseImportCard({ liveImport }: { liveImport: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const form = event.currentTarget;
    const connection = (
      form.elements.namedItem('connection') as HTMLInputElement | null
    )?.value?.trim();
    if (!connection) {
      setError('Connection string is required.');
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(connection)) {
      setError('Enter a connection URL such as postgres://user:pass@host/db.');
      return;
    }

    if (!liveImport) {
      setMessage(
        'Demo only — connection string validated locally. No remote database pull was started.',
      );
      return;
    }

    startTransition(async () => {
      const result = await createImportJobAction({
        source: 'DATABASE',
        filename: connection.replace(/:\/\/.*@/, '://***@').slice(0, 80),
        rows: 0,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to queue import');
        return;
      }
      setMessage(result.message ?? `Import job ${result.id} queued.`);
    });
  }

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
        <form className="space-y-3" onSubmit={onSubmit} noValidate>
          <FormField id="db-conn" label="Connection string" required>
            <Input
              id="db-conn"
              name="connection"
              placeholder="postgres://…"
              aria-invalid={Boolean(error)}
              onChange={() => {
                setError(null);
                setMessage(null);
              }}
            />
          </FormField>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {message && (
            <Alert
              variant={liveImport ? 'default' : 'warning'}
              data-testid={liveImport ? 'database-live-submit' : 'database-demo-submit'}
            >
              <AlertTitle>{liveImport ? 'Import queued' : 'Demo submit'}</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Importing…' : 'Import'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
