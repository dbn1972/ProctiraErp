'use client';

/**
 * Export academic periods as an ICS calendar download.
 *
 * Uses periods already loaded on the page — no dedicated export API.
 */
import { Download } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { downloadIcs } from '@/lib/download';
import type { AcademicPeriod } from '@/lib/institutions/types';

interface ExportCalendarButtonProps {
  periods: AcademicPeriod[];
}

export function ExportCalendarButton({ periods }: ExportCalendarButtonProps) {
  const disabled = periods.length === 0;

  function handleExport() {
    if (periods.length === 0) return;
    downloadIcs(
      'academic-periods.ics',
      periods.map((p) => ({
        uid: `${p.id}@proctira.academic-periods`,
        summary: p.name,
        description: `${p.code} · ${p.status}`,
        startDate: p.startDate,
        endDate: p.endDate,
        status: p.status === 'active' ? 'CONFIRMED' : 'TENTATIVE',
      })),
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={disabled}
      title={
        disabled
          ? 'No academic periods to export'
          : 'Download periods as an ICS calendar'
      }
      onClick={handleExport}
    >
      <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
      Export calendar
    </Button>
  );
}
