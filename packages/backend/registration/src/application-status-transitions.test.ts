/**
 * PRC-L031 — staff application status changes must follow the transition map.
 */
import { describe, expect, it } from 'vitest';
import { ConflictError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { isAllowedApplicationTransition, RegistrationService } from './registration-service.js';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTITUTION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FORM_CONFIGURATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function seededService() {
  const repo = new InMemoryRegistrationRepository();
  repo.seedInstitutions([
    {
      id: INSTITUTION,
      name: 'Demo School',
      code: 'DEMO',
      typeId: uuidv4(),
      areaId: uuidv4(),
      tenantId: TENANT,
      status: 'ACTIVE',
      latitude: null,
      longitude: null,
      address: null,
    },
  ]);
  repo.seedFormConfigurations([
    {
      id: FORM_CONFIGURATION,
      tenantId: TENANT,
      institutionId: INSTITUTION,
      version: 1,
      publishedAt: '2026-09-19T00:00:00.000Z',
      fields: [],
    },
  ]);
  const service = new RegistrationService(repo);
  await service.submitRegistration(
    TENANT,
    {
      institutionId: INSTITUTION,
      formConfigurationId: FORM_CONFIGURATION,
      formConfigurationVersion: 1,
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '2012-01-01',
      gender: 'female',
      guardianName: 'Parent',
      guardianPhone: '+911234567890',
    },
    'status-transition-ada',
  );
  const [app] = await service.listApplications(TENANT);
  return { service, repo, id: app!.id };
}

describe('application status transitions (PRC-L031)', () => {
  it('allows pending → under_review → approved', async () => {
    const { service, id } = await seededService();
    await service.updateApplicationStatus(TENANT, id, 'under_review');
    const { application } = await service.updateApplicationStatus(TENANT, id, 'approved');
    expect(application.status).toBe('approved');
  });

  it('refuses pending → approved without review', async () => {
    const { service, id } = await seededService();
    await expect(service.updateApplicationStatus(TENANT, id, 'approved')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('refuses changing a final decision', async () => {
    const { service, id } = await seededService();
    await service.updateApplicationStatus(TENANT, id, 'rejected');
    await expect(service.updateApplicationStatus(TENANT, id, 'pending')).rejects.toBeInstanceOf(
      ConflictError,
    );
    const [app] = await service.listApplications(TENANT);
    expect(app!.status).toBe('rejected');
  });

  it('refuses same-status writes', () => {
    expect(isAllowedApplicationTransition('pending', 'pending')).toBe(false);
    expect(isAllowedApplicationTransition('waitlisted', 'approved')).toBe(true);
  });
});

describe('PRC-M334 atomic status + slot booking', () => {
  it('approved -> pending is rejected with 409', async () => {
    const { service, id } = await seededService();
    await service.updateApplicationStatus(TENANT, id, 'under_review');
    await service.updateApplicationStatus(TENANT, id, 'approved');
    await expect(service.updateApplicationStatus(TENANT, id, 'pending')).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('a concurrent status change makes the stale write fail with 409', async () => {
    const { service, repo, id } = await seededService();
    // Simulate another writer moving the application between read and write.
    const original = repo.findById.bind(repo);
    repo.findById = async (...args: Parameters<typeof repo.findById>) => {
      const row = await original(...args);
      await repo.updateStatus(id, 'rejected', undefined, TENANT);
      repo.findById = original;
      return row;
    };
    await expect(
      service.updateApplicationStatus(TENANT, id, 'under_review'),
    ).rejects.toBeInstanceOf(ConflictError);
    const [app] = await service.listApplications(TENANT);
    expect(app!.status).toBe('rejected');
  });

  it('N parallel bookings on a capacity-1 slot -> exactly 1 success', async () => {
    const { service, repo } = await seededService();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await service.submitRegistration(
        TENANT,
        {
          institutionId: INSTITUTION,
          formConfigurationId: FORM_CONFIGURATION,
          formConfigurationVersion: 1,
          firstName: `Kid${i}`,
          lastName: 'Slot',
          dateOfBirth: '2012-01-01',
          gender: 'female',
          guardianName: 'Parent',
          guardianPhone: '+911234567890',
        },
        `slot-race-${i}`,
      );
    }
    for (const row of await repo.listByTenant(TENANT)) ids.push(row.id);
    const slot = await service.createInterviewSlot(TENANT, {
      institutionId: INSTITUTION,
      startsAt: '2026-09-20T10:00:00.000Z',
      endsAt: '2026-09-20T10:30:00.000Z',
      capacity: 1,
    });
    const results = await Promise.allSettled(
      ids.map((applicationId) => service.bookInterview(TENANT, { slotId: slot.id, applicationId })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});
