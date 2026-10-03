/**
 * Browser helpers for downloading generated files (CSV exports, etc.).
 */

import { csvCell } from './csv-cell';

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  // PRC-M382: formula-injection guard + RFC 4180 quoting for every caller.
  const escape = csvCell;

  const lines = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
