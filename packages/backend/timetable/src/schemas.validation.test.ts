import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { CreateBellScheduleSchema, CreatePeriodSchema, UpdateBellScheduleSchema } from './schemas';

const schedule = { institutionId: 'i1', academicPeriodId: 'ap1', name: 'Day' };
const period = { name: 'P1', periodOrder: 1 };

describe('timetable schema validation (PRC-L260)', () => {
  it('accepts weekday patterns 1–7 and rejects anything else', () => {
    expect(Value.Check(CreateBellScheduleSchema, { ...schedule, dayPattern: '1,2,3,4,5' })).toBe(
      true,
    );
    expect(Value.Check(CreateBellScheduleSchema, { ...schedule, dayPattern: '7' })).toBe(true);
    for (const bad of ['1,2,9', '0', 'mon', '1,,2', '1,2,', ' 1']) {
      expect(Value.Check(CreateBellScheduleSchema, { ...schedule, dayPattern: bad })).toBe(false);
      expect(Value.Check(UpdateBellScheduleSchema, { dayPattern: bad })).toBe(false);
    }
  });

  it('enforces HH:mm within 00:00–23:59', () => {
    expect(
      Value.Check(CreatePeriodSchema, { ...period, startTime: '00:00', endTime: '23:59' }),
    ).toBe(true);
    for (const bad of ['99:99', '24:00', '12:60', '8:00']) {
      expect(Value.Check(CreatePeriodSchema, { ...period, startTime: bad, endTime: '23:00' })).toBe(
        false,
      );
    }
  });
});
