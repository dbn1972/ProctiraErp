/**
 * /attendance/reports — Attendance percentage report (Server Component shell).
 *
 * Implements Requirement 9.4: percentages per student / class / institution
 * for configurable date ranges, rounded to two decimal places.
 */
import Link from 'next/link';

import { ArrowLeft, ClipboardCheck, Download } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { listInstitutions } from '@/lib/api/institutions';

import { AttendanceReportFilters } from '../_components/attendance-report-filters';

export const dynamic = 'force-dynamic';

export default async function AttendanceReportsPage() {
  const institutions = await listInstitutions({ pageSize: 200 });

  return (
    <section aria-labelledby="reports-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/attendance">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to attendance
        </Link>
      </Button>

      {/* ── Page head ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="reports-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Attendance analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Attendance percentage for a student, class, or institution over a configurable date
            range. Percentages are rounded to two decimal places.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled>
            <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
          <Button asChild size="sm">
            <Link href="/attendance">
              <ClipboardCheck className="me-1.5 h-4 w-4" aria-hidden="true" />
              Mark attendance
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scope &amp; date range</CardTitle>
          <CardDescription>Choose the scope and date range, then run the report.</CardDescription>
        </CardHeader>
        <CardContent>
          <AttendanceReportFilters
            institutions={institutions.map((i) => ({
              id: i.id,
              name: i.name,
            }))}
          />
        </CardContent>
      </Card>
    </section>
  );
}
