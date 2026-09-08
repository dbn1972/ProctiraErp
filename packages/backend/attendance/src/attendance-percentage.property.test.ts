/**
 * Property-based test for Attendance Percentage Calculation.
 *
 * **Property 21: Attendance Percentage Calculation**
 *
 * For any set of attendance records with known statuses, the calculated attendance
 * percentage equals (present + late) / total * 100, rounded to exactly 2 decimal places.
 * The absence percentage equals absent / total * 100, rounded to exactly 2 decimal places.
 * The calculation works correctly for student, class, and institution scopes.
 *
 * **Validates: Requirements 9.4**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { AttendanceStatus } from '@proctira/common';

import { AttendanceService } from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import type { StudentAttendanceEntity } from './attendance-repository.js';

// --- Constants ---

const TENANT_ID = 'tenant-prop21';
const INSTITUTION_ID = 'inst-prop21-1111-4111-8111-111111111111';
const CLASS_ID = 'class-prop21-2222-4222-8222-222222222222';
const STUDENT_ID = 'student-prop21-3333-4333-8333-333333333333';
const PERIOD_ID = 'period-prop21-4444-4444-8444-444444444444';

// --- Arbitraries ---

/** Generates a valid attendance status. */
const attendanceStatusArb: fc.Arbitrary<AttendanceStatus> = fc.constantFrom(
  AttendanceStatus.PRESENT,
  AttendanceStatus.ABSENT,
  AttendanceStatus.LATE,
  AttendanceStatus.EXCUSED,
);

/** Generates a date string in YYYY-MM-DD format within a fixed range. */
const dateStrArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') })
  .map((d) => d.toISOString().split('T')[0]!);

/** Generates a unique ID for records. */
const idArb: fc.Arbitrary<string> = fc
  .tuple(fc.hexaString({ minLength: 8, maxLength: 8 }), fc.nat())
  .map(([hex, n]) => `rec-${hex}-${n}`);

/**
 * Generates a list of attendance records with known statuses for a single student.
 * Each record has a unique date to avoid duplicates.
 */
function studentRecordsArb(
  minLength: number,
  maxLength: number,
): fc.Arbitrary<Array<{ id: string; date: string; status: AttendanceStatus }>> {
  return fc
    .uniqueArray(dateStrArb, { minLength, maxLength, comparator: (a, b) => a === b })
    .chain((dates) =>
      fc.tuple(...dates.map((date) => fc.tuple(idArb, fc.constant(date), attendanceStatusArb))),
    )
    .map((tuples) => tuples.map(([id, date, status]) => ({ id, date, status })));
}

/**
 * Generates attendance records for multiple students in a class.
 */
function classRecordsArb(): fc.Arbitrary<
  Array<{ id: string; studentId: string; date: string; status: AttendanceStatus }>
> {
  return fc
    .array(
      fc.tuple(
        idArb,
        fc.hexaString({ minLength: 6, maxLength: 6 }).map((h) => `student-${h}`),
        dateStrArb,
        attendanceStatusArb,
      ),
      { minLength: 1, maxLength: 30 },
    )
    .map((tuples) =>
      tuples.map(([id, studentId, date, status]) => ({ id, studentId, date, status })),
    );
}

// --- Helper Functions ---

/**
 * Reference implementation: calculates expected attendance percentage.
 * (present + late) / total * 100, rounded to 2 decimal places.
 */
function expectedAttendancePercentage(statuses: AttendanceStatus[]): number {
  if (statuses.length === 0) return 0;
  const presentCount = statuses.filter((s) => s === AttendanceStatus.PRESENT).length;
  const lateCount = statuses.filter((s) => s === AttendanceStatus.LATE).length;
  return Math.round(((presentCount + lateCount) / statuses.length) * 10000) / 100;
}

/**
 * Reference implementation: calculates expected absence percentage.
 * absent / total * 100, rounded to 2 decimal places.
 */
function expectedAbsencePercentage(statuses: AttendanceStatus[]): number {
  if (statuses.length === 0) return 0;
  const absentCount = statuses.filter((s) => s === AttendanceStatus.ABSENT).length;
  return Math.round((absentCount / statuses.length) * 10000) / 100;
}

/**
 * Checks that a number has at most 2 decimal places.
 * Uses a small epsilon to account for floating point representation.
 */
function hasAtMostTwoDecimalPlaces(n: number): boolean {
  const scaled = n * 100;
  return Math.abs(Math.round(scaled) - scaled) < 1e-10;
}

/**
 * Seeds attendance records into the repository for a given student.
 */
async function seedStudentRecords(
  repository: InMemoryAttendanceRepository,
  records: Array<{ id: string; date: string; status: AttendanceStatus }>,
  studentId: string = STUDENT_ID,
): Promise<void> {
  for (const record of records) {
    await repository.createStudentAttendance({
      id: record.id,
      tenantId: TENANT_ID,
      studentId,
      institutionId: INSTITUTION_ID,
      classId: CLASS_ID,
      academicPeriodId: PERIOD_ID,
      date: record.date,
      subjectId: null,
      periodId: null,
      status: record.status,
      comment: null,
      recordedBy: 'test-user',
    });
  }
}

// --- Property Tests ---

describe('Property 21: Attendance Percentage Calculation', () => {
  // **Validates: Requirements 9.4**

  let service: AttendanceService;
  let repository: InMemoryAttendanceRepository;

  beforeEach(() => {
    repository = new InMemoryAttendanceRepository();
    service = new AttendanceService(repository);
  });

  describe('Attendance percentage formula: (present + late) / total * 100, rounded to 2 decimal places', () => {
    it('attendance percentage equals (present + late) / total * 100 for any set of records', async () => {
      await fc.assert(
        fc.asyncProperty(studentRecordsArb(1, 50), async (records) => {
          // Clear and seed
          repository.clear();
          await seedStudentRecords(repository, records);

          // Calculate using the service
          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'student',
            studentId: STUDENT_ID,
            classId: CLASS_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          // Verify against reference implementation
          const statuses = records.map((r) => r.status);
          const expected = expectedAttendancePercentage(statuses);

          expect(result.attendancePercentage).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });

    it('result is always rounded to exactly 2 decimal places', async () => {
      await fc.assert(
        fc.asyncProperty(studentRecordsArb(1, 50), async (records) => {
          repository.clear();
          await seedStudentRecords(repository, records);

          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'student',
            studentId: STUDENT_ID,
            classId: CLASS_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          expect(hasAtMostTwoDecimalPlaces(result.attendancePercentage)).toBe(true);
          expect(hasAtMostTwoDecimalPlaces(result.absencePercentage)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Absence percentage formula: absent / total * 100, rounded to 2 decimal places', () => {
    it('absence percentage equals absent / total * 100 for any set of records', async () => {
      await fc.assert(
        fc.asyncProperty(studentRecordsArb(1, 50), async (records) => {
          repository.clear();
          await seedStudentRecords(repository, records);

          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'student',
            studentId: STUDENT_ID,
            classId: CLASS_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          const statuses = records.map((r) => r.status);
          const expected = expectedAbsencePercentage(statuses);

          expect(result.absencePercentage).toBe(expected);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Calculation works correctly for all scopes (student, class, institution)', () => {
    it('class scope aggregates all students in the class', async () => {
      await fc.assert(
        fc.asyncProperty(classRecordsArb(), async (records) => {
          repository.clear();

          // Seed records for multiple students in the same class
          for (const record of records) {
            await repository.createStudentAttendance({
              id: record.id,
              tenantId: TENANT_ID,
              studentId: record.studentId,
              institutionId: INSTITUTION_ID,
              classId: CLASS_ID,
              academicPeriodId: PERIOD_ID,
              date: record.date,
              subjectId: null,
              periodId: null,
              status: record.status,
              comment: null,
              recordedBy: 'test-user',
            });
          }

          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'class',
            classId: CLASS_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          const statuses = records.map((r) => r.status);
          const expectedAttendance = expectedAttendancePercentage(statuses);
          const expectedAbsence = expectedAbsencePercentage(statuses);

          expect(result.attendancePercentage).toBe(expectedAttendance);
          expect(result.absencePercentage).toBe(expectedAbsence);
          expect(result.totalRecords).toBe(records.length);
          expect(result.scope).toBe('class');
        }),
        { numRuns: 100 },
      );
    });

    it('institution scope aggregates all records for the institution', async () => {
      await fc.assert(
        fc.asyncProperty(classRecordsArb(), async (records) => {
          repository.clear();

          // Seed records for multiple students across different classes but same institution
          for (const record of records) {
            await repository.createStudentAttendance({
              id: record.id,
              tenantId: TENANT_ID,
              studentId: record.studentId,
              institutionId: INSTITUTION_ID,
              classId: `class-${record.studentId}`, // Different classes
              academicPeriodId: PERIOD_ID,
              date: record.date,
              subjectId: null,
              periodId: null,
              status: record.status,
              comment: null,
              recordedBy: 'test-user',
            });
          }

          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'institution',
            institutionId: INSTITUTION_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          const statuses = records.map((r) => r.status);
          const expectedAttendance = expectedAttendancePercentage(statuses);
          const expectedAbsence = expectedAbsencePercentage(statuses);

          expect(result.attendancePercentage).toBe(expectedAttendance);
          expect(result.absencePercentage).toBe(expectedAbsence);
          expect(result.totalRecords).toBe(records.length);
          expect(result.scope).toBe('institution');
        }),
        { numRuns: 100 },
      );
    });

    it('student scope returns only records for the specific student', async () => {
      await fc.assert(
        fc.asyncProperty(
          studentRecordsArb(1, 20),
          studentRecordsArb(1, 20),
          async (targetRecords, otherRecords) => {
            repository.clear();

            const targetStudentId = 'target-student-001';
            const otherStudentId = 'other-student-002';

            // Seed target student records
            await seedStudentRecords(repository, targetRecords, targetStudentId);

            // Seed other student records in the same class
            for (const record of otherRecords) {
              await repository.createStudentAttendance({
                id: `other-${record.id}`,
                tenantId: TENANT_ID,
                studentId: otherStudentId,
                institutionId: INSTITUTION_ID,
                classId: CLASS_ID,
                academicPeriodId: PERIOD_ID,
                date: record.date,
                subjectId: null,
                periodId: null,
                status: record.status,
                comment: null,
                recordedBy: 'test-user',
              });
            }

            const result = await service.calculateAttendancePercentage(TENANT_ID, {
              scope: 'student',
              studentId: targetStudentId,
              classId: CLASS_ID,
              startDate: '2024-01-01',
              endDate: '2024-12-31',
            });

            // Should only reflect the target student's records
            const targetStatuses = targetRecords.map((r) => r.status);
            const expectedAttendance = expectedAttendancePercentage(targetStatuses);
            const expectedAbsence = expectedAbsencePercentage(targetStatuses);

            expect(result.attendancePercentage).toBe(expectedAttendance);
            expect(result.absencePercentage).toBe(expectedAbsence);
            expect(result.totalRecords).toBe(targetRecords.length);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Edge cases', () => {
    it('empty records return 0% for both attendance and absence', async () => {
      repository.clear();

      const result = await service.calculateAttendancePercentage(TENANT_ID, {
        scope: 'student',
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });

      expect(result.attendancePercentage).toBe(0);
      expect(result.absencePercentage).toBe(0);
      expect(result.totalRecords).toBe(0);
      expect(result.presentCount).toBe(0);
      expect(result.absentCount).toBe(0);
      expect(result.lateCount).toBe(0);
      expect(result.excusedCount).toBe(0);
    });

    it('single record returns correct percentage for each status', async () => {
      await fc.assert(
        fc.asyncProperty(attendanceStatusArb, idArb, dateStrArb, async (status, id, date) => {
          repository.clear();
          await seedStudentRecords(repository, [{ id, date, status }]);

          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'student',
            studentId: STUDENT_ID,
            classId: CLASS_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          expect(result.totalRecords).toBe(1);

          // Single PRESENT or LATE record → 100% attendance
          if (status === AttendanceStatus.PRESENT || status === AttendanceStatus.LATE) {
            expect(result.attendancePercentage).toBe(100);
            expect(result.absencePercentage).toBe(0);
          }
          // Single ABSENT record → 0% attendance, 100% absence
          if (status === AttendanceStatus.ABSENT) {
            expect(result.attendancePercentage).toBe(0);
            expect(result.absencePercentage).toBe(100);
          }
          // Single EXCUSED record → 0% attendance, 0% absence
          if (status === AttendanceStatus.EXCUSED) {
            expect(result.attendancePercentage).toBe(0);
            expect(result.absencePercentage).toBe(0);
          }
        }),
        { numRuns: 20 },
      );
    });

    it('all present records yield 100% attendance and 0% absence', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (count) => {
          repository.clear();

          const records = Array.from({ length: count }, (_, i) => ({
            id: `all-present-${i}`,
            date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
            status: AttendanceStatus.PRESENT,
          }));

          await seedStudentRecords(repository, records);

          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'student',
            studentId: STUDENT_ID,
            classId: CLASS_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          expect(result.attendancePercentage).toBe(100);
          expect(result.absencePercentage).toBe(0);
        }),
        { numRuns: 20 },
      );
    });

    it('all absent records yield 0% attendance and 100% absence', async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (count) => {
          repository.clear();

          const records = Array.from({ length: count }, (_, i) => ({
            id: `all-absent-${i}`,
            date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
            status: AttendanceStatus.ABSENT,
          }));

          await seedStudentRecords(repository, records);

          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'student',
            studentId: STUDENT_ID,
            classId: CLASS_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          expect(result.attendancePercentage).toBe(0);
          expect(result.absencePercentage).toBe(100);
        }),
        { numRuns: 20 },
      );
    });

    it('percentage values are always between 0 and 100 inclusive', async () => {
      await fc.assert(
        fc.asyncProperty(studentRecordsArb(1, 50), async (records) => {
          repository.clear();
          await seedStudentRecords(repository, records);

          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'student',
            studentId: STUDENT_ID,
            classId: CLASS_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          expect(result.attendancePercentage).toBeGreaterThanOrEqual(0);
          expect(result.attendancePercentage).toBeLessThanOrEqual(100);
          expect(result.absencePercentage).toBeGreaterThanOrEqual(0);
          expect(result.absencePercentage).toBeLessThanOrEqual(100);
        }),
        { numRuns: 100 },
      );
    });

    it('count breakdown sums to total records', async () => {
      await fc.assert(
        fc.asyncProperty(studentRecordsArb(1, 50), async (records) => {
          repository.clear();
          await seedStudentRecords(repository, records);

          const result = await service.calculateAttendancePercentage(TENANT_ID, {
            scope: 'student',
            studentId: STUDENT_ID,
            classId: CLASS_ID,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          });

          const sumOfCounts =
            result.presentCount + result.absentCount + result.lateCount + result.excusedCount;
          expect(sumOfCounts).toBe(result.totalRecords);
        }),
        { numRuns: 100 },
      );
    });
  });
});
