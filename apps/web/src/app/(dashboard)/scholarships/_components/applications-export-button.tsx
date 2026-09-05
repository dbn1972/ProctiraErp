'use client';

/**
 * Export loaded scholarship applications as CSV.
 */
import { Download } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { downloadCsv } from '@/lib/download';
import type { ScholarshipApplication } from '@/lib/api/scholarships';

interface ApplicationsExportButtonProps {
  applications: ScholarshipApplication[];
}

export function ApplicationsExportButton({
  applications,
}: ApplicationsExportButtonProps) {
  const disabled = applications.length === 0;

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={disabled}
      title={disabled ? 'No applications to export' : 'Export applications as CSV'}
      onClick={() => {
        downloadCsv(
          'scholarship-applications.csv',
          [
            'id',
            'applicantName',
            'applicantId',
            'programId',
            'programName',
            'submittedAt',
            'status',
            'totalScore',
          ],
          applications.map((a) => [
            a.id,
            a.applicantName,
            a.applicantId,
            a.programId,
            a.programName,
            a.submittedAt,
            a.status,
            a.totalScore ?? '',
          ]),
        );
      }}
    >
      <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
      Export
    </Button>
  );
}
