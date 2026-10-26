/**
 * PRC-L316 (10b): calendar-date validation.
 *
 * `^\d{4}-\d{2}-\d{2}$` (the schemas.ts pattern) and `new Date(...)` both
 * accept digit-shaped nonsense like '2024-13-45' (schema regex) or silently
 * roll '2024-02-30' forward to March 1 (Date parsing) instead of rejecting
 * it. assertValidCalendarDate replaces reliance on Date parsing with
 * explicit year/month/day range checks.
 *
 * Failing-first: before this fix, createMeasurement/createVaccination/
 * createCounsellingSession had no calendar-date check at all — '2024-13-45'
 * would have been passed straight through to the repository (and these
 * `.rejects.toThrow(BusinessRuleError)` assertions would have resolved
 * instead of rejecting).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError } from '@proctira/common';

import { HealthService, assertValidCalendarDate } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

describe('PRC-L316 (10b): assertValidCalendarDate', () => {
  it('rejects an invalid month', () => {
    expect(() => assertValidCalendarDate('2024-13-45', 'date')).toThrow(BusinessRuleError);
  });

  it('rejects a day that does not exist even in a valid month (not a non-leap Feb 30)', () => {
    expect(() => assertValidCalendarDate('2024-02-30', 'date')).toThrow(BusinessRuleError);
  });

  it('rejects Feb 29 on a non-leap year', () => {
    expect(() => assertValidCalendarDate('2023-02-29', 'date')).toThrow(BusinessRuleError);
  });

  it('accepts Feb 29 on a leap year', () => {
    expect(() => assertValidCalendarDate('2024-02-29', 'date')).not.toThrow();
  });

  it('rejects a year below the default minYear floor (1900)', () => {
    expect(() => assertValidCalendarDate('1899-01-01', 'date')).toThrow(BusinessRuleError);
  });

  it('rejects a future date unless allowFuture is set', () => {
    expect(() => assertValidCalendarDate('2999-01-01', 'date')).toThrow(BusinessRuleError);
    expect(() =>
      assertValidCalendarDate('2999-01-01', 'date', { allowFuture: true }),
    ).not.toThrow();
  });

  it('accepts a well-formed past date', () => {
    expect(() => assertValidCalendarDate('2024-03-15', 'date')).not.toThrow();
  });
});

describe('PRC-L316 (10b): wired into HealthService create methods', () => {
  let service: HealthService;
  let repository: InMemoryHealthRepository;
  const tenantId = 'tenant-001';
  const studentId = 'student-001';

  const healthOfficerContext: HealthAccessContext = {
    userId: 'user-health-officer',
    roles: ['health_admin'],
    guardianOfStudentIds: [],
  };

  beforeEach(() => {
    repository = new InMemoryHealthRepository();
    service = new HealthService(repository);
  });

  it('createMeasurement rejects an invalid calendar date (2024-13-45)', async () => {
    await expect(
      service.createMeasurement(
        tenantId,
        { studentId, date: '2024-13-45', height: 165 },
        healthOfficerContext,
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('createVaccination rejects an invalid dateAdministered', async () => {
    await expect(
      service.createVaccination(
        tenantId,
        {
          studentId,
          vaccineName: 'MMR',
          doseNumber: 1,
          dateAdministered: '2024-02-30',
        },
        healthOfficerContext,
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('createCounsellingSession rejects an invalid sessionDate', async () => {
    await expect(
      service.createCounsellingSession(
        tenantId,
        {
          studentId,
          counsellorId: 'staff-counsellor-001',
          sessionDate: '2024-00-15',
          sessionType: 'individual',
          reason: 'Check-in',
          caseNotes: 'notes',
          followUpRequired: false,
          status: 'completed',
        },
        healthOfficerContext,
      ),
    ).rejects.toThrow(BusinessRuleError);
  });
});
