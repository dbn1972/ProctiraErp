'use client';

import { useState } from 'react';
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

/**
 * Import source forms with client-side validation.
 * Submit stays demo-only until the warehouse import API is wired.
 */
export function ImportSourceForms() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <FileImportCard
        icon={<FileSpreadsheet className="h-6 w-6" aria-hidden="true" />}
        title="Excel"
        description="Upload an .xlsx workbook (max 50 MB)."
        accept=".xlsx,.xls"
      />
      <FileImportCard
        icon={<FileText className="h-6 w-6" aria-hidden="true" />}
        title="CSV"
        description="Upload a .csv file with a header row."
        accept=".csv"
      />
      <DatabaseImportCard />
    </div>
  );
}

function FileImportCard({
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
  const [error, setError] = useState<string | null>(null);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDemoMessage(null);
    const form = event.currentTarget;
    const input = form.elements.namedItem('file') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      setError(`Choose a ${title} file before uploading.`);
      return;
    }
    setDemoMessage(
      `Demo only — “${file.name}” was validated locally. No import job was queued (warehouse API not connected).`,
    );
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
              setDemoMessage(null);
            }}
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {demoMessage && (
            <Alert variant="warning" data-testid={`${title.toLowerCase()}-demo-submit`}>
              <AlertTitle>Demo submit</AlertTitle>
              <AlertDescription>{demoMessage}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="sm">
            Upload
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DatabaseImportCard() {
  const [error, setError] = useState<string | null>(null);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDemoMessage(null);
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
    setDemoMessage(
      'Demo only — connection string validated locally. No remote database pull was started.',
    );
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
                setDemoMessage(null);
              }}
            />
          </FormField>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {demoMessage && (
            <Alert variant="warning" data-testid="database-demo-submit">
              <AlertTitle>Demo submit</AlertTitle>
              <AlertDescription>{demoMessage}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="sm">
            Import
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
