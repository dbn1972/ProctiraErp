/**
 * PRC-M382: one CSV cell for client-side exports. Text starting with a formula trigger
 * (= + - @ TAB CR) is prefixed with a single quote so spreadsheets never evaluate it;
 * numbers are emitted as-is (a negative number is data, not a formula). Cells containing
 * a quote, comma or line break are RFC 4180-quoted.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
