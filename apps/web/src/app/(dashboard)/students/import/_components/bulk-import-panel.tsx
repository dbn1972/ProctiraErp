'use client';

/**
 * Client-side bulk import flow for students.
 *
 * Steps: select file → choose duplicate handling → submit → review result.
 * Submits to the `submitBulkImportAction` Server Action which streams the
 * file to the import endpoint via the gateway. Progress for async jobs is
 * polled from `getImportProgress`.
 */
import { AlertCircle, CheckCircle2, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  Badge,
  Button,
  FormField,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  type ImportProgress,
  type ImportResult,
} from '@/lib/api/students';

import { submitBulkImportAction } from '../../actions';

const ACCEPTED_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

type ImportStatus = 'idle' | 'submitting' | 'completed' | 'queued' | 'error';

export function BulkImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [duplicateResolution, setDuplicateResolution] = useState<
    'skip' | 'update' | 'create'
  >('skip');
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  // Poll progress when an async job is in flight.
  useEffect(() => {
    if (!progress || progress.status === 'completed' || progress.status === 'failed') {
      return;
    }
    const interval = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/students/import/${encodeURIComponent(progress.jobId)}`,
            { credentials: 'include' },
          );
          if (response.ok) {
            const next = (await response.json()) as ImportProgress;
            setProgress(next);
            if (next.status === 'completed' && next.result) {
              setResult(next.result);
              setStatus('completed');
              setStatusMessage('Import complete.');
              clearInterval(interval);
            } else if (next.status === 'failed') {
              setStatus('error');
              setStatusMessage(next.errorMessage ?? 'Import failed.');
              clearInterval(interval);
            }
          }
        } catch {
          // Ignore transient errors and let the next tick try again.
        }
      })();
    }, 1500);
    return () => clearInterval(interval);
  }, [progress]);

  function onSelectFile(event: React.ChangeEvent<HTMLInputElement>) {
    setValidationError(null);
    const next = event.target.files?.[0] ?? null;
    if (!next) {
      setFile(null);
      return;
    }
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setValidationError('File exceeds the 50 MB limit.');
      setFile(null);
      return;
    }
    if (next.type && !ACCEPTED_TYPES.includes(next.type)) {
      setValidationError('Only Excel (.xlsx) files are accepted.');
      setFile(null);
      return;
    }
    setFile(next);
    setResult(null);
    setProgress(null);
    setStatus('idle');
    setStatusMessage(null);
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setValidationError(null);
    const next = event.dataTransfer.files?.[0] ?? null;
    if (!next) return;
    if (next.size > MAX_FILE_SIZE_BYTES) {
      setValidationError('File exceeds the 50 MB limit.');
      return;
    }
    if (next.type && !ACCEPTED_TYPES.includes(next.type)) {
      setValidationError('Only Excel (.xlsx) files are accepted.');
      return;
    }
    setFile(next);
    setResult(null);
    setProgress(null);
    setStatus('idle');
    setStatusMessage(null);
  }

  async function onSubmit() {
    if (!file) {
      setValidationError('Select a file before importing.');
      return;
    }
    setStatus('submitting');
    setStatusMessage('Uploading file…');
    try {
      const fileBase64 = await fileToBase64(file);
      const action = await submitBulkImportAction({
        fileBase64,
        fileName: file.name,
        mimeType:
          file.type ||
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        duplicateResolution,
        async: false,
      });
      if (action.status === 'error') {
        setStatus('error');
        setStatusMessage(action.message ?? 'Import failed.');
        return;
      }
      const data = action.data;
      if (!data) {
        setStatus('error');
        setStatusMessage('No response from the import endpoint.');
        return;
      }
      if ('jobId' in data) {
        setProgress(data);
        setStatus('queued');
        setStatusMessage(`Queued for background processing (${data.jobId}).`);
      } else {
        setResult(data);
        setStatus('completed');
        setStatusMessage(action.message ?? 'Import complete.');
      }
    } catch (error) {
      setStatus('error');
      setStatusMessage(
        error instanceof Error ? error.message : 'Unexpected import failure.',
      );
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setProgress(null);
    setStatus('idle');
    setStatusMessage(null);
    setValidationError(null);
  }

  return (
    <div className="space-y-5">
      <FormField id="duplicateResolution" label="Duplicate handling">
        <Select
          value={duplicateResolution}
          onValueChange={(value) =>
            setDuplicateResolution(value as 'skip' | 'update' | 'create')
          }
        >
          <SelectTrigger id="duplicateResolution">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">Skip duplicates</SelectItem>
            <SelectItem value="update">Update existing records</SelectItem>
            <SelectItem value="create">Create new records anyway</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <div>
        <Label htmlFor="import-file" className="mb-2 inline-flex">
          Excel file
        </Label>
        <label
          htmlFor="import-file"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-[hsl(var(--input))] bg-[hsl(var(--muted))]/30 p-6 text-center text-sm hover:bg-[hsl(var(--muted))]/50"
        >
          <Upload className="h-6 w-6 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <div>
            <p className="font-medium">
              {file ? file.name : 'Drop your Excel file here'}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                : 'Or click to browse. Up to 50 MB.'}
            </p>
          </div>
          <input
            id="import-file"
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={onSelectFile}
            className="sr-only"
          />
        </label>
        {validationError && (
          <p className="mt-2 text-xs text-[hsl(var(--destructive))]" role="alert">
            {validationError}
          </p>
        )}
      </div>

      {statusMessage && (
        <div
          className={
            status === 'error'
              ? 'flex items-start gap-2 rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 p-3 text-sm text-[hsl(var(--destructive))]'
              : status === 'completed'
                ? 'flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800'
                : 'flex items-start gap-2 rounded-md border bg-[hsl(var(--muted))] p-3 text-sm'
          }
          role="status"
          aria-live="polite"
        >
          {status === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : status === 'completed' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : null}
          <p>{statusMessage}</p>
        </div>
      )}

      {progress && progress.status !== 'completed' && (
        <div className="space-y-1">
          <p className="text-sm">
            Processing… {progress.processedRows.toLocaleString()} of{' '}
            {progress.totalRows.toLocaleString()} rows.
          </p>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.progressPercent}
          >
            <div
              className="h-full bg-[hsl(var(--primary))] transition-all"
              style={{ width: `${progress.progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {result && <ResultPanel result={result} />}

      <div className="flex justify-end gap-2">
        {file && (
          <Button type="button" variant="ghost" onClick={reset}>
            <X className="me-2 h-4 w-4" aria-hidden="true" />
            Reset
          </Button>
        )}
        <Button
          type="button"
          onClick={() => void onSubmit()}
          disabled={!file || status === 'submitting' || status === 'queued'}
        >
          {status === 'submitting' ? 'Uploading…' : 'Start import'}
        </Button>
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: ImportResult }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Total rows" value={result.totalRows} />
        <Stat label="Imported" value={result.successCount} variant="success" />
        <Stat
          label="Errors"
          value={result.errorCount}
          variant={result.errorCount > 0 ? 'destructive' : 'muted'}
        />
        <Stat
          label="Duplicates"
          value={result.duplicateCount}
          variant={result.duplicateCount > 0 ? 'warning' : 'muted'}
        />
      </div>

      {result.errors.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Validation errors</h2>
          <Table aria-label="Validation errors">
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.errors.slice(0, 100).map((err, idx) => (
                <TableRow key={`${err.rowNumber}-${err.field}-${idx}`}>
                  <TableCell>{err.rowNumber}</TableCell>
                  <TableCell>{err.field}</TableCell>
                  <TableCell>{err.message}</TableCell>
                  <TableCell>
                    <Badge variant="destructive">{err.code}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {result.errors.length > 100 && (
            <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
              Showing the first 100 of {result.errors.length} errors.
            </p>
          )}
        </div>
      )}

      {result.duplicates.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Duplicate matches</h2>
          <Table aria-label="Duplicate matches">
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Match type</TableHead>
                <TableHead>Existing student</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.duplicates.map((dup, idx) => (
                <TableRow key={`${dup.rowNumber}-${idx}`}>
                  <TableCell>{dup.rowNumber}</TableCell>
                  <TableCell>{dup.matchType}</TableCell>
                  <TableCell>{dup.existingStudentId}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  variant = 'muted',
}: {
  label: string;
  value: number;
  variant?: 'muted' | 'success' | 'destructive' | 'warning';
}) {
  const colorClasses: Record<string, string> = {
    muted: 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]',
    success: 'bg-emerald-100 text-emerald-800',
    destructive: 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]',
    warning: 'bg-amber-100 text-amber-800',
  };
  return (
    <div className={`rounded-md p-3 ${colorClasses[variant]}`}>
      <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  // Fallback for environments without btoa.
  const buf = Buffer.from(binary, 'binary');
  return buf.toString('base64');
}
