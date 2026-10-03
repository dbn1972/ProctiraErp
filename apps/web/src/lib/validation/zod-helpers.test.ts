/**
 * PRC-M494: date plausibility and size bounds across web schemas.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attendanceMarkingFormSchema } from './attendance-schema';
import { studentPhotoUploadSchema } from './student-360-schema';
import { studentFormSchema } from './student-schema';
import { base64DecodedBytes, isRealIsoDate, isoDate, todayInTimeZone } from './zod-helpers';
const U1 = '11111111-1111-4111-8111-111111111111';
const baseStudent = {
  firstName: 'A',
  lastName: 'B',
  dateOfBirth: '2015-04-01',
  gender: 'F',
  nationalId: '',
  nationality: '',
  contacts: [],
  guardians: [],
  identityDocuments: [],
  customData: {},
};
afterEach(() => {
  vi.useRealTimers();
});
describe('zod helpers (PRC-M494)', () => {
  it('rejects impossible calendar dates', () => {
    expect(isRealIsoDate('2025-02-31')).toBe(false);
    expect(isRealIsoDate('2024-02-29')).toBe(true);
    expect(isoDate.safeParse('2025-02-31').success).toBe(false);
  });
  it('today is the tenant wall-clock day (IST), not UTC', () => {
    // 2025-03-10 01:00 IST == 2025-03-09 19:30 UTC
    const now = new Date('2025-03-09T19:30:00.000Z');
    expect(todayInTimeZone('Asia/Kolkata', now)).toBe('2025-03-10');
  });
  it('computes decoded base64 size', () => {
    expect(base64DecodedBytes(btoa('hello'))).toBe(5);
  });
});
describe('student schema', () => {
  it('rejects a date of birth tomorrow', () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(studentFormSchema.safeParse({ ...baseStudent, dateOfBirth: tomorrow }).success).toBe(false);
    expect(studentFormSchema.safeParse(baseStudent).success).toBe(true);
  });
  it('rejects 2025-02-31 and unbounded customData', () => {
    expect(studentFormSchema.safeParse({ ...baseStudent, dateOfBirth: '2015-02-31' }).success).toBe(false);
    const big = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i]));
    expect(studentFormSchema.safeParse({ ...baseStudent, customData: big }).success).toBe(false);
  });
});
describe('attendance schema', () => {
  const marking = (date: string, records = [{ studentId: U1, status: 'PRESENT' }]) => ({
    institutionId: U1,
    classId: U1,
    academicPeriodId: U1,
    date,
    records,
  });
  it('accepts local today at 01:00 IST', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-09T19:30:00.000Z'));
    expect(attendanceMarkingFormSchema.safeParse(marking('2025-03-10')).success).toBe(true);
    expect(attendanceMarkingFormSchema.safeParse(marking('2025-03-11')).success).toBe(false);
  });
  it('rejects duplicate studentIds', () => {
    const rows = [
      { studentId: U1, status: 'PRESENT' },
      { studentId: U1, status: 'ABSENT' },
    ];
    expect(attendanceMarkingFormSchema.safeParse(marking('2024-01-02', rows)).success).toBe(false);
  });
});
describe('student photo upload', () => {
  it('rejects a 3 MB base64 photo client-side', () => {
    const threeMb = 'A'.repeat(Math.ceil((3 * 1024 * 1024 * 4) / 3));
    expect(
      studentPhotoUploadSchema.safeParse({ contentBase64: threeMb, mimeType: 'image/png' }).success,
    ).toBe(false);
    expect(
      studentPhotoUploadSchema.safeParse({ contentBase64: btoa('png'), mimeType: 'image/png' }).success,
    ).toBe(true);
  });
});
