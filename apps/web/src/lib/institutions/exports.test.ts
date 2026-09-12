import { describe, expect, it } from 'vitest';

import { renderAcademicCalendarIcs } from './ics';
import { hierarchyToCsv } from './infrastructure-csv';
import type { AcademicPeriod, CalendarEvent } from './types';

const period: AcademicPeriod = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 't',
  name: 'AY 2026-27',
  code: 'AY26',
  startDate: '2026-06-01',
  endDate: '2027-03-31',
  status: 'active',
  kind: 'year',
  parentId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as AcademicPeriod;

const event: CalendarEvent = {
  id: '22222222-2222-4222-8222-222222222222',
  academicPeriodId: period.id,
  institutionId: null,
  kind: 'holiday',
  name: 'Diwali; lamps, sweets',
  startDate: '2026-11-08',
  endDate: '2026-11-10',
  notes: null,
  createdAt: '2026-01-01T00:00:00Z',
} as CalendarEvent;

describe('renderAcademicCalendarIcs (G-905/G-925)', () => {
  const ics = renderAcademicCalendarIcs({
    tenantId: 'tenant-a',
    periods: [period],
    events: [event],
    now: new Date('2026-09-09T08:00:00Z'),
  });

  it('emits a VCALENDAR with one VEVENT per period and per event', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('uses exclusive all-day DTEND and escapes RFC 5545 text', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20261108');
    expect(ics).toContain('DTEND;VALUE=DATE:20261111');
    expect(ics).toContain('SUMMARY:Diwali\\; lamps\\, sweets');
    expect(ics).toContain('DTSTAMP:20260909T080000Z');
  });

  it('scopes UIDs to the tenant', () => {
    expect(ics).toContain(`UID:event-${event.id}@tenant-a.proctira`);
  });

  it('publishes METHOD:PUBLISH and remains valid with periods-only (no events)', () => {
    const emptyEvents = renderAcademicCalendarIcs({
      tenantId: 'tenant-a',
      periods: [period],
      events: [],
      now: new Date('2026-09-09T08:00:00Z'),
    });
    expect(emptyEvents).toContain('METHOD:PUBLISH');
    expect(emptyEvents.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(emptyEvents.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

describe('hierarchyToCsv (G-925)', () => {
  it('flattens land → building → floor → room and quotes commas', () => {
    const csv = hierarchyToCsv({
      lands: [
        {
          id: 'l',
          name: 'Main campus',
          capacity: 0,
          condition: 'GOOD',
          description: null,
          buildings: [
            {
              id: 'b',
              name: 'Block A, North',
              capacity: 400,
              condition: 'FAIR',
              description: 'Two storeys',
              floors: [
                {
                  id: 'f',
                  name: 'Ground',
                  capacity: 200,
                  condition: 'GOOD',
                  description: null,
                  rooms: [
                    {
                      id: 'r',
                      name: 'G-01',
                      capacity: 40,
                      condition: 'NEEDS_REPAIR',
                      description: null,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('level,path,name,capacity,condition,description');
    expect(lines).toHaveLength(5);
    expect(lines[2]).toBe('building,Main campus,"Block A, North",400,FAIR,Two storeys');
    expect(lines[4]).toBe('room,"Main campus / Block A, North / Ground",G-01,40,NEEDS_REPAIR,');
  });
});
