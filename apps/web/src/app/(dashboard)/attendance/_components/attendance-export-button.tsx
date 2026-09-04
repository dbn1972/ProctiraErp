'use client';

/**
 * Client export button for attendance analytics.
 *
 * Generates CSV from the loaded report result (no export API). Disabled until
 * a successful report run provides rows.
 */
import { Download } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import type { AttendancePercentageResult } from '@/lib/api/attendance';

interface AttendanceExportButtonProps {
  result: AttendancePercentageResult | null;
  meta?: {
    scope: string;
    institutionId?: string;
    startDate?: string;
    endDate?: string;
  };
}

export function AttendanceExportButton({
  result,
  meta,
}: AttendanceExportButtonProps) {
  const disabled = !result;

  function handleExport() {
    if (!result) return;
    const total = result.totalRecords || 1;
    const lines = [
      [
        'scope',
        'institutionId',
        'startDate',
        'endDate',
        'totalRecords',
        'presentCount',
        'absentCount',
        'lateCount',
        'excusedCount',
        'attendancePercentage',
        'absencePercentage',
      ].join(','),
      [
        result.scope,
        meta?.institutionId ?? '',
        meta?.startDate ?? '',
        meta?.endDate ?? '',
        result.totalRecords,
        result.presentCount,
        result.absentCount,
        result.lateCount,
        result.excusedCount,
        result.attendancePercentage,
        result.absencePercentage,
      ].join(','),
      '',
      'metric,count,sharePercent',
      `Present,${result.presentCount},${((result.presentCount / total) * 100).toFixed(2)}`,
      `Absent,${result.absentCount},${((result.absentCount / total) * 100).toFixed(2)}`,
      `Late,${result.lateCount},${((result.lateCount / total) * 100).toFixed(2)}`,
      `Excused,${result.excusedCount},${((result.excusedCount / total) * 100).toFixed(2)}`,
      '',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-report-${result.scope}-${meta?.startDate ?? 'range'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={disabled}
      title={disabled ? 'Run a report first to enable CSV export' : 'Export report as CSV'}
      onClick={handleExport}
    >
      <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
      Export CSV
    </Button>
  );
}
