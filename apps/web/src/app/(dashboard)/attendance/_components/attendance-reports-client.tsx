'use client';

/**
 * Attendance reports shell — page head CTAs + filters/results.
 *
 * Keeps Export CSV in the page head while enabling it from loaded report
 * state owned by this client boundary.
 */
import Link from 'next/link';
import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import type { AttendancePercentageResult } from '@/lib/api/attendance';

import { AttendanceExportButton } from './attendance-export-button';
import { AttendanceReportFilters } from './attendance-report-filters';

interface InstitutionOption {
  id: string;
  name: string;
}

interface AttendanceReportsClientProps {
  institutions: InstitutionOption[];
}

export function AttendanceReportsClient({
  institutions,
}: AttendanceReportsClientProps) {
  const [result, setResult] = useState<AttendancePercentageResult | null>(null);
  const [meta, setMeta] = useState<{
    scope: string;
    institutionId?: string;
    startDate?: string;
    endDate?: string;
  } | null>(null);

  return (
    <section aria-labelledby="reports-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="reports-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Attendance analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Attendance percentage for a student, class, or institution over a
            configurable date range. Percentages are rounded to two decimal places.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <AttendanceExportButton result={result} meta={meta ?? undefined} />
          <Button asChild size="sm">
            <Link href="/attendance">
              <ClipboardCheck className="me-1.5 h-4 w-4" aria-hidden="true" />
              Mark attendance
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <AttendanceReportFilters
            institutions={institutions}
            onReportLoaded={(next, nextMeta) => {
              setResult(next);
              setMeta(nextMeta);
            }}
          />
        </CardContent>
      </Card>
    </section>
  );
}
