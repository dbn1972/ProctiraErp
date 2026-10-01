/**
 * PRC-L031 — staff application status changes must follow the transition map.
 */
import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@proctira/common';
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
  return { service, id: app!.id };
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
      BusinessRuleError,
    );
  });

  it('refuses changing a final decision', async () => {
    const { service, id } = await seededService();
    await service.updateApplicationStatus(TENANT, id, 'rejected');
    await expect(service.updateApplicationStatus(TENANT, id, 'pending')).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    const [app] = await service.listApplications(TENANT);
    expect(app!.status).toBe('rejected');
  });

  it('refuses same-status writes', () => {
    expect(isAllowedApplicationTransition('pending', 'pending')).toBe(false);
    expect(isAllowedApplicationTransition('waitlisted', 'approved')).toBe(true);
  });
});
