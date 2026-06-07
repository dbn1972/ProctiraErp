/**
 * /attendance/reports — Attendance percentage report (Server Component shell).
 *
 * Implements Requirement 9.4: percentages per student / class / institution
 * for configurable date ranges, rounded to two decimal places.
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
import { listInstitutions } from '@/lib/api/institutions';

import { AttendanceReportFilters } from '../_components/attendance-report-filters';

export const dynamic = 'force-dynamic';

export default async function AttendanceReportsPage() {
  const institutions = await listInstitutions({ pageSize: 200 });

  return (
    <section aria-labelledby="reports-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/attendance">
          <ArrowLeft className="me-2 h-4 w-4" aria-hidden="true" />
          Back to attendance
        </Link>
      </Button>

      <div>
        <h1 id="reports-heading" className="text-2xl font-semibold tracking-tight">
          Attendance reports
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Calculate attendance percentage for a student, class, or institution
          over a configurable date range. Percentages are rounded to two
          decimal places.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Choose the scope and date range to calculate.
          </CardDescription>
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
