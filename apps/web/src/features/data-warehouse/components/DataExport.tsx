/**
 * DataExport — export data query results in XLSX, CSV, or DI7-compatible Excel.
 *
 * Provides export buttons that trigger server-side export generation and
 * return a download URL.
 *
 * Task 60A.5 / Requirements 15.4
 */

import { useCallback, useState } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@proctira/ui/components';
import { exportData, type DataQueryParams } from '../api/data-warehouse-browser';

interface DataExportProps {
  /** Current query parameters to export */
  queryParams: DataQueryParams;
  /** Whether export is disabled (e.g., no query configured) */
  disabled?: boolean;
}

type ExportFormat = 'xlsx' | 'csv' | 'di7';

const FORMAT_LABELS: Record<ExportFormat, string> = {
  xlsx: 'Excel (XLSX)',
  csv: 'CSV',
  di7: 'DI7-Compatible Excel',
};

export function DataExport({ queryParams, disabled = false }: DataExportProps) {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      setExporting(format);
      try {
        const result = await exportData({ ...queryParams, format });
        // Trigger download
        const link = document.createElement('a');
        link.href = result.downloadUrl;
        link.download = `data-warehouse-export.${format === 'di7' ? 'xlsx' : format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        console.error(`Failed to export as ${format}:`, err);
      } finally {
        setExporting(null);
      }
    },
    [queryParams],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled || exporting !== null}>
          {exporting ? `Exporting ${FORMAT_LABELS[exporting]}…` : 'Export Data'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('xlsx')}>
          {FORMAT_LABELS.xlsx}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('csv')}>
          {FORMAT_LABELS.csv}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('di7')}>
          {FORMAT_LABELS.di7}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
