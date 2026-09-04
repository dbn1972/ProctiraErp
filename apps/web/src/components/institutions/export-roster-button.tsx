'use client';

/**
 * Export class sections as CSV from rows already loaded on the page.
 */
import { Download } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { downloadCsv } from '@/lib/download';

export interface ClassRosterExportRow {
  classLabel: string;
  teacher: string;
  capacity: string;
  room: string;
}

interface ExportRosterButtonProps {
  rows: ClassRosterExportRow[];
  institutionId: string;
}

export function ExportRosterButton({ rows, institutionId }: ExportRosterButtonProps) {
  const disabled = rows.length === 0;

  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={disabled}
      title={disabled ? 'No sections to export' : 'Download class roster as CSV'}
      onClick={() => {
        downloadCsv(
          `institution-${institutionId}-class-roster.csv`,
          ['class', 'classTeacher', 'capacity', 'room'],
          rows.map((r) => [r.classLabel, r.teacher, r.capacity, r.room]),
        );
      }}
    >
      <Download className="me-1.5 h-4 w-4" aria-hidden="true" />
      Export roster
    </Button>
  );
}
