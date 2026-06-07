/**
 * Property-based tests for Attendance Roster Accuracy and Date Validation.
 *
 * Property 20: Attendance Roster Accuracy
 *
 * For any class and date, the pre-populated attendance roster SHALL contain exactly
 * those students with active enrollment where enrollment start_date ≤ attendance date
 * and (end_date is null or end_date ≥ attendance date).
 *
 * **Validates: Requirements 9.3**
 *
 * Property 22: Attendance Date Validation
 *
 * For any attendance recording attempt, the system SHALL accept only dates that are
 * the current date or past dates within the active academic period, and SHALL reject
 * future dates or dates outside the active period.
 *
 * **Validates: Requirements 9.7**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { BusinessRuleError } from '@proctira/common';

import { AttendanceService } from './attendance-service.js';
import type {
  AttendanceRepository,
  StudentRosterEntry,
  AcademicPeriodInfo,
} from './attendance-repository.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';

// --- Arbitraries ---

/** Generates a valid UUID v4 string. */
const uuidArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.constantFrom('8', '9', 'a', 'b'),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map(([p1, p2, p3, variant, p4, p5]) => `${p1}-${p2}-4${p3}-${variant}${p4}-${p5}`);

/** Generates a date string in YYYY-MM-DD format within a given range. */
function dateStrArb(min: Date, max: Date): fc.Arbitrary<string> {
  return fc
    .date({ min, max })
    .map((d) => d.toISOString().split('T')[0]!);
}

/** Generates a student name. */
const studentNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'),
    fc.constantFrom('Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'),
  )
  .map(([first, last]) => `${first} ${last}`);

/**
 * Enrollment record for testing roster accuracy.
 * Represents a student's enrollment in a class with start/end dates.
 */
interface TestEnrollment {
  studentId: string;
  studentName: string;
  enrollmentId: string;
  classId: string;
  gradeId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD or null (still active)
}

/**
 * Generates a test enrollment with dates within the academic period.
 */
function enrollmentArb(
  classId: string,
  gradeId: string,
  periodStart: Date,
  periodEnd: Date,
): fc.Arbitrary<TestEnrollment> {
  return fc.record({
    studentId: uuidArb,
    studentName: studentNameArb,
    enrollmentId: uuidArb,
    classId: fc.constant(classId),
    gradeId: fc.constant(gradeId),
    startDate: dateStrArb(periodStart, periodEnd),
    endDate: fc.oneof(
      fc.constant(null), // Still enrolled (no end date)
      dateStrArb(periodStart, periodEnd), // Ended within period
    ),
  }).filter((e) => {
    // Ensure endDate >= startDate when endDate is not null
    if (e.endDate === null) return true;
    return e.endDate >= e.startDate;
  });
}

// --- Roster Filtering Logic (mirrors what a real repository should do) ---

/**
 * Determines if a student should appear in the roster for a given date.
 * This is the reference implementation of the roster accuracy property.
 *
 * A student is included if:
 * - enrollment start_date <= attendance date
 * - enrollment end_date is null OR end_date >= attendance date
 */
function shouldBeInRoster(enrollment: TestEnrollment, attendanceDate: string): boolean {
  return (
    enrollment.startDate <= attendanceDate &&
    (enrollment.endDate === null || enrollment.endDate >= attendanceDate)
  );
}

/**
 * A date-aware in-memory repository that filters roster by enrollment dates.
 * This implements the correct behavior per Requirement 9.3.
 */
class DateAwareAttendanceRepository extends InMemoryAttendanceRepository {
  private enrollments: TestEnrollment[] = [];

  addEnrollment(enrollment: TestEnrollment): void {
    this.enrollments.push(enrollment);
  }

  clearEnrollments(): void {
    this.enrollments = [];
  }

  override async getClassRoster(
    _tenantId: string,
    classId: string,
    _academicPeriodId: string,
    date: string,
  ): Promise<StudentRosterEntry[]> {
    // Filter enrollments by class and date (Requirement 9.3)
    return this.enrollments
      .filter(
        (e) =>
          e.classId === classId &&
          e.startDate <= date &&
          (e.endDate === null || e.endDate >= date),
      )
      .map((e) => ({
        studentId: e.studentId,
        studentName: e.studentName,
        enrollmentId: e.enrollmentId,
        classId: e.classId,
        gradeId: e.gradeId,
      }));
  }
}

// --- Property 20: Attendance Roster Accuracy ---

describe('Property 20: Attendance Roster Accuracy', () => {
  // **Validates: Requirements 9.3**

  let service: AttendanceService;
  let repository: DateAwareAttendanceRepository;

  const TENANT_ID = 'tenant-prop20';
  const CLASS_ID = 'class-prop20-1111-4111-8111-111111111111';
  const GRADE_ID = 'grade-prop20-2222-4222-8222-222222222222';
  const PERIOD_ID = 'period-prop20-3333-4333-8333-333333333333';
  const PERIOD_START = new Date('2024-01-01');
  const PERIOD_END = new Date('2024-12-31');

  beforeEach(() => {
    repository = new DateAwareAttendanceRepository();
    service = new AttendanceService(repository);

    repository.addAcademicPeriod({
      id: PERIOD_ID,
      tenantId: TENANT_ID,
      name: 'Academic Year 2024',
      startDate: PERIOD_START,
      endDate: PERIOD_END,
      status: 'active',
    });
  });

  it('roster contains exactly students with active enrollment on the attendance date', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-10 enrollments for the class
        fc.array(enrollmentArb(CLASS_ID, GRADE_ID, PERIOD_START, PERIOD_END), {
          minLength: 1,
          maxLength: 10,
        }),
        // Generate an attendance date within the period
        dateStrArb(PERIOD_START, PERIOD_END),
        async (enrollments, attendanceDate) => {
          // Setup: add all enrollments to the repository
          repository.clearEnrollments();
          for (const enrollment of enrollments) {
            repository.addEnrollment(enrollment);
          }

          // Act: get the class roster for the given date
          const roster = await service.getClassRoster(
            TENANT_ID,
            CLASS_ID,
            PERIOD_ID,
            attendanceDate,
          );

          // Expected: students whose enrollment covers the attendance date
          const expectedStudentIds = enrollments
            .filter((e) => shouldBeInRoster(e, attendanceDate))
            .map((e) => e.studentId);

          const actualStudentIds = roster.map((r) => r.studentId);

          // Property: roster contains exactly the expected students
          expect(actualStudentIds.sort()).toEqual(expectedStudentIds.sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('students whose enrollment ended before the attendance date are excluded', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        studentNameArb,
        uuidArb,
        // Generate enrollment that ended before a specific date
        fc.record({
          startDate: dateStrArb(PERIOD_START, new Date('2024-06-01')),
          endDate: dateStrArb(PERIOD_START, new Date('2024-06-01')),
        }).filter((r) => r.endDate >= r.startDate),
        // Attendance date is after the enrollment end date
        dateStrArb(new Date('2024-06-02'), PERIOD_END),
        async (studentId, studentName, enrollmentId, dates, attendanceDate) => {
          // Only proceed if attendance date is actually after end date
          if (attendanceDate <= dates.endDate) return;

          repository.clearEnrollments();
          repository.addEnrollment({
            studentId,
            studentName,
            enrollmentId,
            classId: CLASS_ID,
            gradeId: GRADE_ID,
            startDate: dates.startDate,
            endDate: dates.endDate,
          });

          const roster = await service.getClassRoster(
            TENANT_ID,
            CLASS_ID,
            PERIOD_ID,
            attendanceDate,
          );

          // Student whose enrollment ended before the date should NOT be in roster
          const studentInRoster = roster.some((r) => r.studentId === studentId);
          expect(studentInRoster).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('students with null end date (ongoing enrollment) are always included after start date', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        studentNameArb,
        uuidArb,
        // Enrollment start date within first half of period
        dateStrArb(PERIOD_START, new Date('2024-06-30')),
        // Attendance date within second half of period (guaranteed after start)
        dateStrArb(new Date('2024-07-01'), PERIOD_END),
        async (studentId, studentName, enrollmentId, startDate, attendanceDate) => {
          // Only proceed if attendance date is on or after start date
          if (attendanceDate < startDate) return;

          repository.clearEnrollments();
          repository.addEnrollment({
            studentId,
            studentName,
            enrollmentId,
            classId: CLASS_ID,
            gradeId: GRADE_ID,
            startDate,
            endDate: null, // Ongoing enrollment
          });

          const roster = await service.getClassRoster(
            TENANT_ID,
            CLASS_ID,
            PERIOD_ID,
            attendanceDate,
          );

          // Student with ongoing enrollment should be in roster
          const studentInRoster = roster.some((r) => r.studentId === studentId);
          expect(studentInRoster).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('students whose enrollment has not started yet are excluded', async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        studentNameArb,
        uuidArb,
        // Enrollment starts in second half of period
        dateStrArb(new Date('2024-07-01'), PERIOD_END),
        // Attendance date in first half (before enrollment starts)
        dateStrArb(PERIOD_START, new Date('2024-06-30')),
        async (studentId, studentName, enrollmentId, startDate, attendanceDate) => {
          // Only proceed if attendance date is actually before start date
          if (attendanceDate >= startDate) return;

          repository.clearEnrollments();
          repository.addEnrollment({
            studentId,
            studentName,
            enrollmentId,
            classId: CLASS_ID,
            gradeId: GRADE_ID,
            startDate,
            endDate: null,
          });

          const roster = await service.getClassRoster(
            TENANT_ID,
            CLASS_ID,
            PERIOD_ID,
            attendanceDate,
          );

          // Student whose enrollment hasn't started should NOT be in roster
          const studentInRoster = roster.some((r) => r.studentId === studentId);
          expect(studentInRoster).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 22: Attendance Date Validation ---

describe('Property 22: Attendance Date Validation', () => {
  // **Validates: Requirements 9.7**

  let service: AttendanceService;
  let repository: InMemoryAttendanceRepository;

  beforeEach(() => {
    repository = new InMemoryAttendanceRepository();
    service = new AttendanceService(repository);
  });

  /**
   * Helper to get today's date as YYYY-MM-DD in UTC.
   */
  function getTodayStr(): string {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today.toISOString().split('T')[0]!;
  }

  it('accepts current date when within active academic period', () => {
    const todayStr = getTodayStr();
    const today = new Date(todayStr + 'T00:00:00Z');

    // Period that encompasses today
    const periodStart = new Date(today);
    periodStart.setFullYear(periodStart.getFullYear() - 1);
    const periodEnd = new Date(today);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    // Should not throw
    expect(() =>
      service.validateAttendanceDate(todayStr, periodStart, periodEnd),
    ).not.toThrow();
  });

  it('accepts any past date within the active academic period', () => {
    const todayStr = getTodayStr();
    const today = new Date(todayStr + 'T00:00:00Z');

    // Period: from 2 years ago to 1 year in the future
    const periodStart = new Date(today);
    periodStart.setFullYear(periodStart.getFullYear() - 2);
    const periodEnd = new Date(today);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    fc.assert(
      fc.property(
        // Generate past dates within the period (between period start and today)
        dateStrArb(periodStart, today),
        (dateStr) => {
          // Should not throw for any past date within the period
          expect(() =>
            service.validateAttendanceDate(dateStr, periodStart, periodEnd),
          ).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects all future dates with appropriate error message', () => {
    const todayStr = getTodayStr();
    const today = new Date(todayStr + 'T00:00:00Z');

    // Period that extends into the future
    const periodStart = new Date(today);
    periodStart.setFullYear(periodStart.getFullYear() - 1);
    const periodEnd = new Date(today);
    periodEnd.setFullYear(periodEnd.getFullYear() + 2);

    // Generate future dates (tomorrow onwards, within the period end)
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    fc.assert(
      fc.property(
        dateStrArb(tomorrow, periodEnd),
        (futureDateStr) => {
          // Should throw BusinessRuleError for any future date
          expect(() =>
            service.validateAttendanceDate(futureDateStr, periodStart, periodEnd),
          ).toThrow(BusinessRuleError);

          // Verify error message indicates future attendance cannot be recorded
          try {
            service.validateAttendanceDate(futureDateStr, periodStart, periodEnd);
          } catch (error: any) {
            expect(error).toBeInstanceOf(BusinessRuleError);
            expect(error.message.toLowerCase()).toContain('future');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects dates before the academic period start', () => {
    const todayStr = getTodayStr();
    const today = new Date(todayStr + 'T00:00:00Z');

    // Period starts 6 months ago
    const periodStart = new Date(today);
    periodStart.setMonth(periodStart.getMonth() - 6);
    const periodEnd = new Date(today);
    periodEnd.setMonth(periodEnd.getMonth() + 6);

    // Generate dates before the period start
    const wayBefore = new Date(periodStart);
    wayBefore.setFullYear(wayBefore.getFullYear() - 2);
    const dayBeforePeriod = new Date(periodStart);
    dayBeforePeriod.setDate(dayBeforePeriod.getDate() - 1);

    fc.assert(
      fc.property(
        dateStrArb(wayBefore, dayBeforePeriod),
        (earlyDateStr) => {
          // Should throw BusinessRuleError for dates before period start
          expect(() =>
            service.validateAttendanceDate(earlyDateStr, periodStart, periodEnd),
          ).toThrow(BusinessRuleError);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects dates after the academic period end (even if in the past)', () => {
    const todayStr = getTodayStr();
    const today = new Date(todayStr + 'T00:00:00Z');

    // Period that ended in the past
    const periodStart = new Date('2022-01-01');
    const periodEnd = new Date('2022-12-31');

    // Generate dates after the period end but still in the past (before today)
    const dayAfterPeriod = new Date(periodEnd);
    dayAfterPeriod.setDate(dayAfterPeriod.getDate() + 1);

    // Only test if dayAfterPeriod is still in the past
    if (dayAfterPeriod <= today) {
      const maxDate = new Date(Math.min(today.getTime(), new Date('2023-12-31').getTime()));

      fc.assert(
        fc.property(
          dateStrArb(dayAfterPeriod, maxDate),
          (lateDateStr) => {
            // Should throw BusinessRuleError for dates after period end
            expect(() =>
              service.validateAttendanceDate(lateDateStr, periodStart, periodEnd),
            ).toThrow(BusinessRuleError);
          },
        ),
        { numRuns: 100 },
      );
    }
  });

  it('the period start date itself is accepted (boundary)', () => {
    const todayStr = getTodayStr();
    const today = new Date(todayStr + 'T00:00:00Z');

    // Period that started in the past
    const periodStart = new Date(today);
    periodStart.setFullYear(periodStart.getFullYear() - 1);
    const periodEnd = new Date(today);
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    const periodStartStr = periodStart.toISOString().split('T')[0]!;

    // Period start date should be accepted (it's a past date within the period)
    expect(() =>
      service.validateAttendanceDate(periodStartStr, periodStart, periodEnd),
    ).not.toThrow();
  });

  it('date validation outcome depends only on date relative to today and period bounds', () => {
    const todayStr = getTodayStr();
    const today = new Date(todayStr + 'T00:00:00Z');

    fc.assert(
      fc.property(
        // Generate period start (1-3 years ago)
        fc.integer({ min: 1, max: 3 }).map((yearsAgo) => {
          const d = new Date(today);
          d.setFullYear(d.getFullYear() - yearsAgo);
          return d;
        }),
        // Generate period end (1-3 years in the future)
        fc.integer({ min: 1, max: 3 }).map((yearsAhead) => {
          const d = new Date(today);
          d.setFullYear(d.getFullYear() + yearsAhead);
          return d;
        }),
        // Generate any date in a wide range
        dateStrArb(new Date('2020-01-01'), new Date('2030-12-31')),
        (periodStart, periodEnd, dateStr) => {
          const attendanceDate = new Date(dateStr + 'T00:00:00Z');
          const periodStartNorm = new Date(periodStart);
          periodStartNorm.setUTCHours(0, 0, 0, 0);
          const periodEndNorm = new Date(periodEnd);
          periodEndNorm.setUTCHours(0, 0, 0, 0);

          const isFuture = attendanceDate > today;
          const isBeforePeriod = attendanceDate < periodStartNorm;
          const isAfterPeriod = attendanceDate > periodEndNorm;

          const shouldReject = isFuture || isBeforePeriod || isAfterPeriod;

          if (shouldReject) {
            expect(() =>
              service.validateAttendanceDate(dateStr, periodStart, periodEnd),
            ).toThrow(BusinessRuleError);
          } else {
            expect(() =>
              service.validateAttendanceDate(dateStr, periodStart, periodEnd),
            ).not.toThrow();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
