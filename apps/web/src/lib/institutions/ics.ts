/**
 * G-905 / G-925 — iCalendar (RFC 5545) rendering for the academic calendar.
 *
 * Periods and calendar events are all-day spans; DTEND is exclusive so the
 * inclusive end date is advanced by one day.
 */
import type { AcademicPeriod, CalendarEvent } from './types';

const KIND_LABELS: Record<CalendarEvent['kind'], string> = {
  holiday: 'Holiday',
  break: 'Break',
  grading_window: 'Grading window',
  exam_window: 'Exam window',
  event: 'Event',
};

function icsDate(iso: string, addDays = 0): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets per RFC 5545 §3.1. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function vevent(fields: {
  uid: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
  categories?: string;
  stamp: string;
}): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${fields.uid}`,
    `DTSTAMP:${fields.stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(fields.start)}`,
    `DTEND;VALUE=DATE:${icsDate(fields.end, 1)}`,
    `SUMMARY:${escapeText(fields.summary)}`,
  ];
  if (fields.categories) lines.push(`CATEGORIES:${escapeText(fields.categories)}`);
  if (fields.description) lines.push(`DESCRIPTION:${escapeText(fields.description)}`);
  lines.push('END:VEVENT');
  return lines;
}

export interface AcademicCalendarIcsInput {
  tenantId: string;
  periods: AcademicPeriod[];
  events: CalendarEvent[];
  /** Injected for deterministic output in tests. */
  now?: Date;
}

export function renderAcademicCalendarIcs(input: AcademicCalendarIcsInput): string {
  const stamp = (input.now ?? new Date())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const periodName = new Map(input.periods.map((p) => [p.id, p.name]));
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ProctiraERP//Academic Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Academic calendar',
  ];
  for (const p of [...input.periods].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    lines.push(
      ...vevent({
        uid: `period-${p.id}@${input.tenantId}.proctira`,
        summary: p.name,
        start: p.startDate,
        end: p.endDate,
        categories: p.kind === 'year' ? 'Academic year' : p.kind,
        description: `${p.code} · ${p.status}`,
        stamp,
      }),
    );
  }
  for (const e of [...input.events].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const parent = periodName.get(e.academicPeriodId);
    lines.push(
      ...vevent({
        uid: `event-${e.id}@${input.tenantId}.proctira`,
        summary: e.name,
        start: e.startDate,
        end: e.endDate,
        categories: KIND_LABELS[e.kind],
        description: [parent, e.notes].filter(Boolean).join(' · ') || undefined,
        stamp,
      }),
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
