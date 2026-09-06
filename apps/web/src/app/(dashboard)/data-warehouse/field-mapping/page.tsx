/**
 * Import field-mapping step (Server Component) — Insights & System.
 *
 * Redesign “map” means column → warehouse-field mapping, not GIS.
 * GIS remains at `/data-warehouse/map`.
 *
 * Validates: Requirement 15.1 — import pipeline Mapping step.
 */
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';
import { cn } from '@/lib/utils';

import { FieldMappingForm } from './field-mapping-form';

export const dynamic = 'force-dynamic';

const IMPORT_STEPS = ['Source', 'Mapping', 'Validate', 'Run'] as const;

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

      <ScaffoldModeBanner
        surface="Field mapping"
        detail="Demo columns are shown until an upload attaches real headers. Continue validates locally; it does not start a live validate/run job."
      />

      <ImportStepper activeIndex={1} />

      <FieldMappingForm />
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
