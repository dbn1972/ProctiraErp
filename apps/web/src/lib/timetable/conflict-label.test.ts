import { describe, expect, it } from 'vitest';

import { formatScheduleConflict } from './conflict-label';

describe('formatScheduleConflict', () => {
  it('uses teacher and period names instead of raw ids', () => {
    const text = formatScheduleConflict(
      {
        reason: 'staff',
        againstMeetingId: 'm2',
        dayOfWeek: 1,
        periodId: 'p3',
        staffId: 'staff-1',
      },
      {
        staff: new Map([['staff-1', 'Priya Sharma']]),
        room: new Map(),
        period: new Map([['p3', 'Period 3 (09:20–10:00)']]),
        section: new Map(),
      },
    );
    expect(text).toBe('Priya Sharma is double-booked on Mon · Period 3 (09:20–10:00).');
    expect(text).not.toMatch(/[0-9a-f]{8}-/);
  });
});
