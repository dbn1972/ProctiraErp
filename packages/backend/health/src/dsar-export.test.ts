/**
 * PRC-M275: DSAR export completeness.
 *
 *  - (12a) nurseIncidents + phiAccessHistory sections were absent from the
 *    returned `sections` object entirely.
 *  - (12b) every section was silently capped at the first 100 rows via a
 *    one-shot `{ page: 1, pageSize: 100 }` call — a student with >100 rows
 *    in any section exported an incomplete package with no indication rows
 *    were missing.
 *
 * Both cases are failing-first: before this fix, (a) `sections.nurseIncidents`
 * and `sections.phiAccessHistory` were `undefined` (the keys did not exist
 * on the returned object at all), and (b) `sections.measurements.length`
 * would have been capped at 100 regardless of how many rows existed.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { HealthService } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

describe('PRC-M275: exportStudentDsarPackage completeness', () => {
  let service: HealthService;
  let repository: InMemoryHealthRepository;
  const tenantId = 'tenant-001';
  const studentId = 'student-001';

  const healthAdmin: HealthAccessContext = {
    userId: 'user-health-admin',
    roles: ['health_admin'],
    guardianOfStudentIds: [],
  };

  beforeEach(() => {
    repository = new InMemoryHealthRepository();
    service = new HealthService(repository);
  });

  it('returns ALL of a student measurements, not capped at 100', async () => {
    const total = 120;
    for (let i = 0; i < total; i += 1) {
      await service.createMeasurement(
        tenantId,
        { studentId, date: '2024-01-01', height: 150 + i },
        healthAdmin,
      );
    }

    const pack = await service.exportStudentDsarPackage(tenantId, studentId, healthAdmin);
    const measurements = pack.sections['measurements'] as unknown[];
    expect(measurements).toHaveLength(total);
  });

  it('includes nurseIncidents and phiAccessHistory keys populated with the student records', async () => {
    await service.createNurseIncident(
      tenantId,
      {
        studentId,
        incidentAt: '2024-01-05T10:00:00.000Z',
        category: 'injury',
        severity: 'low',
        notes: 'Minor scrape',
        reportedBy: 'nurse-1',
      },
      healthAdmin,
    );
    // A prior read generates a phi-access-log entry via auditPhiRead.
    await service.getMeasurement(
      tenantId,
      (
        await service.createMeasurement(
          tenantId,
          { studentId, date: '2024-01-01', height: 150 },
          healthAdmin,
        )
      ).id,
      healthAdmin,
    );

    const pack = await service.exportStudentDsarPackage(tenantId, studentId, healthAdmin);

    expect(pack.sections).toHaveProperty('nurseIncidents');
    expect(pack.sections).toHaveProperty('phiAccessHistory');
    const nurseIncidents = pack.sections['nurseIncidents'] as Array<{ studentId: string }>;
    expect(nurseIncidents.length).toBeGreaterThanOrEqual(1);
    expect(nurseIncidents[0]!.studentId).toBe(studentId);
    const phiAccessHistory = pack.sections['phiAccessHistory'] as Array<{ studentId: string }>;
    expect(phiAccessHistory.length).toBeGreaterThanOrEqual(1);
    expect(phiAccessHistory[0]!.studentId).toBe(studentId);
  });
});
