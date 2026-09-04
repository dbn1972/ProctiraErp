/**
 * Client-side download helpers for CSV / ICS exports.
 *
 * Prefer these when list data is already loaded in the browser and no
 * dedicated export API exists. Safe to call only from client components.
 */

function triggerDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Escape a CSV cell (RFC 4180-ish). */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** Build a CSV string from headers + row objects/arrays. */
export function rowsToCsv(
  headers: string[],
  rows: Array<Array<unknown> | Record<string, unknown>>,
): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    if (Array.isArray(row)) {
      lines.push(row.map(escapeCsvCell).join(','));
    } else {
      lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
    }
  }
  return `${lines.join('\n')}\n`;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown> | Record<string, unknown>>,
): void {
  const csv = rowsToCsv(headers, rows);
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

/** Format a date (YYYY-MM-DD or ISO) as ICS DATE value. */
function toIcsDate(value: string): string {
  const d = value.slice(0, 10).replace(/-/g, '');
  return d.length === 8 ? d : value.replace(/[^0-9]/g, '').slice(0, 8);
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export interface IcsEventInput {
  uid: string;
  summary: string;
  description?: string;
  startDate: string;
  endDate: string;
  status?: string;
}

/** Build a minimal VCALENDAR document for all-day events. */
export function buildIcsCalendar(events: IcsEventInput[]): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Proctira//Academic Periods//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const event of events) {
    // ICS DTEND is exclusive for all-day events — bump by one day.
    const end = new Date(`${event.endDate.slice(0, 10)}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const endExclusive = end.toISOString().slice(0, 10);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(event.startDate)}`,
      `DTEND;VALUE=DATE:${toIcsDate(endExclusive)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
    );
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    }
    if (event.status) {
      lines.push(`STATUS:${escapeIcsText(event.status.toUpperCase())}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export function downloadIcs(filename: string, events: IcsEventInput[]): void {
  const ics = buildIcsCalendar(events);
  triggerDownload(
    new Blob([ics], { type: 'text/calendar;charset=utf-8' }),
    filename,
  );
}
