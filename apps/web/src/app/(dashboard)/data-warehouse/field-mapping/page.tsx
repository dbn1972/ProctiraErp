/**
 * Import field-mapping step (Server Component) — Insights & System.
 *
 * Redesign “map” means column → warehouse-field mapping, not GIS.
 * GIS remains at `/data-warehouse/map`.
 *
 * Validates: Requirement 15.1 — import pipeline Mapping step.
 */
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Columns3 } from 'lucide-react';

import {
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

export const dynamic = 'force-dynamic';

const IMPORT_STEPS = ['Source', 'Mapping', 'Validate', 'Run'] as const;

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

export default function DataWarehouseFieldMappingPage() {
  return (
    <section aria-labelledby="dw-mapping-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/data-warehouse/import">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to import
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="dw-mapping-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Field mapping
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Map each source column to a warehouse field before validation. GIS map viewing stays on
            a separate route.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/data-warehouse/map">
            Open GIS map
            <ArrowRight className="ms-1.5 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <ImportStepper activeIndex={1} />

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Columns3 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">Column → field</CardTitle>
              <CardDescription>
                Scaffold preview. Wire upload headers to replace demo columns when import jobs
                attach source schema.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <form className="space-y-0" aria-label="Field mapping form">
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
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-4">
              <Button asChild variant="outline" size="sm">
                <Link href="/data-warehouse/import">Back to source</Link>
              </Button>
              <Button type="submit" size="sm" disabled title="Validate step wires with import API">
                Continue to validate
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

function ImportStepper({ activeIndex }: { activeIndex: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Import progress">
      {IMPORT_STEPS.map((label, index) => {
        const isDone = index < activeIndex;
        const isActive = index === activeIndex;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold',
                  isDone && 'bg-primary text-primary-foreground',
                  isActive && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                  !isDone && !isActive && 'bg-muted text-muted-foreground',
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  'text-sm font-medium',
                  isActive || isDone ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {index < IMPORT_STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={cn('h-px flex-1', isDone ? 'bg-primary' : 'bg-border')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
