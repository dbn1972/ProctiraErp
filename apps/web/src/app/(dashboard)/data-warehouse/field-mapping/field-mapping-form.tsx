'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Columns3 } from 'lucide-react';

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';

/** Demo source columns for the empty / scaffold mapping UI (no upload yet). */
const DEMO_SOURCE_COLUMNS = [
  { name: 'student_id', sample: 'STU-1042' },
  { name: 'full_name', sample: 'Ada Lovelace' },
  { name: 'enrolment_date', sample: '2025-09-01' },
  { name: 'institution_code', sample: 'SCH-001' },
] as const;

const WAREHOUSE_FIELDS = [
  { value: '', label: '— Skip column —' },
  { value: 'student.externalId', label: 'Student · external ID' },
  { value: 'student.fullName', label: 'Student · full name' },
  { value: 'enrolment.startDate', label: 'Enrolment · start date' },
  { value: 'institution.code', label: 'Institution · code' },
  { value: 'indicator.value', label: 'Indicator · value' },
] as const;

const selectClassName = cn(
  'flex min-h-11 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2',
  'text-sm text-foreground shadow-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/**
 * Field-mapping form with client validation.
 * Continues to validate even though submit remains demo-only.
 */
export function FieldMappingForm() {
  const [error, setError] = useState<string | null>(null);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDemoMessage(null);
    const form = new FormData(event.currentTarget);
    const mapped = DEMO_SOURCE_COLUMNS.filter((col) => {
      const value = String(form.get(`map[${col.name}]`) ?? '').trim();
      return value.length > 0;
    });
    if (mapped.length === 0) {
      setError('Map at least one source column to a warehouse field (or skip only after mapping one).');
      return;
    }
    setDemoMessage(
      `Demo only — ${mapped.length} column${mapped.length === 1 ? '' : 's'} mapped locally. Validate/run steps are not wired to a live import API.`,
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Columns3 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">Column → field</CardTitle>
            <CardDescription>
              Scaffold preview with demo columns. Wire upload headers when import
              jobs attach source schema.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <form
          className="space-y-0"
          aria-label="Field mapping form"
          onSubmit={onSubmit}
          noValidate
        >
          <Table aria-label="Source column mappings">
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-semibold">Source column</TableHead>
                <TableHead className="font-semibold">Sample</TableHead>
                <TableHead className="font-semibold">Warehouse field</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_SOURCE_COLUMNS.map((col) => (
                <TableRow key={col.name} className="group">
                  <TableCell>
                    <code className="font-mono text-sm font-medium text-foreground">
                      {col.name}
                    </code>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{col.sample}</TableCell>
                  <TableCell>
                    <select
                      id={`map-${col.name}`}
                      name={`map[${col.name}]`}
                      aria-label={`Warehouse field for ${col.name}`}
                      defaultValue=""
                      className={selectClassName}
                      onChange={() => {
                        setError(null);
                        setDemoMessage(null);
                      }}
                    >
                      {WAREHOUSE_FIELDS.map((field) => (
                        <option key={field.value || 'skip'} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="space-y-3 border-t border-border px-4 py-4">
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            {demoMessage && (
              <Alert variant="warning" data-testid="field-mapping-demo-submit">
                <AlertTitle>Demo continue</AlertTitle>
                <AlertDescription>{demoMessage}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/data-warehouse/import">Back to source</Link>
              </Button>
              <Button type="submit" size="sm">
                Continue to validate
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
