/**
 * /students/import — Bulk import workflow — v2.0 redesign.
 *
 * Server Component shell that hosts the client-side multi-step importer.
 * Implements Requirement 6.7 (template download + Excel upload + row errors)
 * and Requirement 6.8 (duplicate handling).
 *
 * v2.0 changes: text-3xl heading, "Download template" in page-head actions,
 * visual 4-step stepper (Upload → Validate → Review → Import).
 */
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { cn } from '@/lib/utils';

import { BulkImportPanel } from './_components/bulk-import-panel';

export const dynamic = 'force-dynamic';

/* ---------------------------------------------------------------- stepper */

const IMPORT_STEPS = [
  { label: 'Upload',   hint: 'Select file' },
  { label: 'Validate', hint: 'Check rows' },
  { label: 'Review',   hint: 'Resolve issues' },
  { label: 'Import',   hint: 'Save records' },
] as const;

/** Visual-only stepper — active step is managed client-side inside BulkImportPanel. */
function ImportStepper({ active = 1 }: { active?: number }) {
  return (
    <nav aria-label="Import steps" className="mb-2">
      <ol className="flex items-start gap-0">
        {IMPORT_STEPS.map((step, i) => {
          const num     = i + 1;
          const isDone  = num < active;
          const isActive= num === active;
          return (
            <li key={step.label} className="flex flex-1 items-start">
              {/* connector line before (except first) */}
              {i > 0 && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'mt-4 h-0.5 flex-1',
                    isDone ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}

              <div className="flex flex-col items-center gap-1.5 px-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    isDone
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {isDone ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : num}
                </span>
                <span
                  className={cn(
                    'text-center text-xs font-medium leading-tight',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {step.label}
                </span>
              </div>

              {/* connector line after (except last) */}
              {i < IMPORT_STEPS.length - 1 && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'mt-4 h-0.5 flex-1',
                    isDone ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------------------------------------------------------- page */

export default function StudentBulkImportPage() {
  return (
    <section aria-labelledby="import-heading" className="space-y-6">

      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="import-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Bulk import students
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Map your spreadsheet columns to ProctiraERP fields. Every row is
            validated before any record is created — nothing is saved until you
            confirm.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/students">
              <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
              Back to students
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a
              href="/api/students/import/template"
              download="students-import-template.xlsx"
            >
              <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
              Download template
            </a>
          </Button>
        </div>
      </div>

      {/* ── Stepper ── */}
      <ImportStepper active={1} />

      {/* ── Template info card ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 1 — Prepare your file</CardTitle>
          <CardDescription>
            Use the template above to fill in student details with the required
            columns and formats. Required: First Name, Last Name, Date of Birth
            (YYYY-MM-DD). Optional: Gender, National ID, Nationality, Guardian
            Name, Guardian Phone, Contact Email.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* ── Upload + validate + import (client-side multi-step) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step 2 — Upload and review</CardTitle>
          <CardDescription>
            Drop the completed Excel file (.xlsx, up to 50&nbsp;MB). We&apos;ll
            validate every row and highlight failures or duplicates before
            importing. Nothing is saved until you confirm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BulkImportPanel />
        </CardContent>
      </Card>
    </section>
  );
}
