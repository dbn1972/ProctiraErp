/**
 * /students/import — Bulk import workflow.
 *
 * Server Component shell that hosts the client-side multi-step importer.
 * Implements Requirement 6.7 (template download + Excel upload + row errors)
 * and Requirement 6.8 (duplicate handling).
 */
import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';

import { BulkImportPanel } from './_components/bulk-import-panel';

export const dynamic = 'force-dynamic';

export default function StudentBulkImportPage() {
  return (
    <section aria-labelledby="import-heading" className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/students">
            <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
            Back to students
          </Link>
        </Button>
      </div>

      <div>
        <h1 id="import-heading" className="text-2xl font-semibold tracking-tight">
          Bulk import students
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Upload an Excel file (.xlsx) up to 50&nbsp;MB. The system validates
          each row and reports failures before any record is created.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 1 — Download template</CardTitle>
          <CardDescription>
            Use the template to fill in student details with the required
            columns and formats.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a
              href="/api/students/import/template"
              download="students-import-template.xlsx"
            >
              Download Excel template
            </a>
          </Button>
          <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
            Required columns: First Name, Last Name, Date of Birth (YYYY-MM-DD).
            Optional columns include Gender, National ID, Nationality, Contact
            Phone, Contact Email, Guardian Name, Guardian Phone.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 2 — Upload and review</CardTitle>
          <CardDescription>
            Drop the completed Excel file. We&apos;ll validate every row and
            highlight failures or duplicates before importing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BulkImportPanel />
        </CardContent>
      </Card>
    </section>
  );
}
