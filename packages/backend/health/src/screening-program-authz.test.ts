/**
 * PRC-L315: screening-program CRUD had no role gating at all in the service
 * layer — any caller, including an unauthenticated/unauthorized context,
 * could create/update/delete/read tenant-wide screening programs. The six
 * screening-program service methods now require an authorized health role +
 * tenant-wide status (reusing the existing hasHealthAccess(ctx, '') branch
 * already used by listNurseIncidents/listAllVaccinations — there is no
 * institution scoping since ScreeningProgramEntity has no institutionId).
 *
 * Failing-first: before this fix none of these six methods took an
 * accessContext parameter at all, so a roles:[] or roles:['teacher'] caller
 * succeeded unconditionally — the ForbiddenError assertions below would not
 * have held against the pre-fix signature.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenError } from '@proctira/common';

import { HealthService } from './health-service.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

describe('PRC-L315 screening-program access control', () => {
  let service: HealthService;
  let repository: InMemoryHealthRepository;
  const tenantId = 'tenant-001';

  const noRoles: HealthAccessContext = {
    userId: 'user-none',
    roles: [],
    guardianOfStudentIds: [],
  };

  const teacher: HealthAccessContext = {
    userId: 'user-teacher',
    roles: ['teacher'],
    guardianOfStudentIds: [],
  };

  const healthOfficer: HealthAccessContext = {
    userId: 'user-health-officer',
    roles: ['health_admin'],
    guardianOfStudentIds: [],
  };

  beforeEach(() => {
    repository = new InMemoryHealthRepository();
    service = new HealthService(repository);
  });

  const createInput = {
    name: 'Grade 1 Vision Screening',
    gradeLevel: 'Grade 1',
    academicPeriodId: 'period-2024',
    assessmentTypes: ['vision'],
    status: 'planned' as const,
  };

  for (const [label, ctx] of [
    ['roles:[]', noRoles],
    ["roles:['teacher']", teacher],
  ] as const) {
    describe(`denies ${label}`, () => {
      it('createScreeningProgram rejects', async () => {
        await expect(service.createScreeningProgram(tenantId, createInput, ctx)).rejects.toThrow(
          ForbiddenError,
        );
      });

      it('updateScreeningProgram rejects', async () => {
        const created = await service.createScreeningProgram(tenantId, createInput, healthOfficer);
        await expect(
          service.updateScreeningProgram(tenantId, created.id, { status: 'in-progress' }, ctx),
        ).rejects.toThrow(ForbiddenError);
      });

      it('deleteScreeningProgram rejects', async () => {
        const created = await service.createScreeningProgram(tenantId, createInput, healthOfficer);
        await expect(service.deleteScreeningProgram(tenantId, created.id, ctx)).rejects.toThrow(
          ForbiddenError,
        );
      });

      it('getScreeningProgram rejects', async () => {
        const created = await service.createScreeningProgram(tenantId, createInput, healthOfficer);
        await expect(service.getScreeningProgram(tenantId, created.id, ctx)).rejects.toThrow(
          ForbiddenError,
        );
      });

      it('listScreeningPrograms rejects', async () => {
        await expect(
          service.listScreeningPrograms(tenantId, { page: 1, pageSize: 10 }, ctx),
        ).rejects.toThrow(ForbiddenError);
      });

      it('listScreeningProgramsByGrade rejects', async () => {
        await expect(
          service.listScreeningProgramsByGrade(tenantId, 'Grade 1', { page: 1, pageSize: 10 }, ctx),
        ).rejects.toThrow(ForbiddenError);
      });
    });
  }

  describe('positive control: health_officer/health_admin succeeds on all six', () => {
    it('allows create/update/delete/get/list/listByGrade', async () => {
      const created = await service.createScreeningProgram(tenantId, createInput, healthOfficer);
      expect(created.id).toBeDefined();

      const updated = await service.updateScreeningProgram(
        tenantId,
        created.id,
        { status: 'in-progress' },
        healthOfficer,
      );
      expect(updated.status).toBe('in-progress');

      const fetched = await service.getScreeningProgram(tenantId, created.id, healthOfficer);
      expect(fetched.id).toBe(created.id);

      const list = await service.listScreeningPrograms(
        tenantId,
        { page: 1, pageSize: 10 },
        healthOfficer,
      );
      expect(list.data.some((p) => p.id === created.id)).toBe(true);

      const byGrade = await service.listScreeningProgramsByGrade(
        tenantId,
        'Grade 1',
        { page: 1, pageSize: 10 },
        healthOfficer,
      );
      expect(byGrade.data.some((p) => p.id === created.id)).toBe(true);

      await service.deleteScreeningProgram(tenantId, created.id, healthOfficer);
      await expect(
        service.getScreeningProgram(tenantId, created.id, healthOfficer),
      ).rejects.toThrow(/not found/i);
    });
  });
});
