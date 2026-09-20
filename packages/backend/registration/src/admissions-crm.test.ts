/**
 * Admissions CRM depth — waitlist + interview slots.
 */
import { describe, expect, it } from 'vitest';
import { BusinessRuleError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { RegistrationService } from './registration-service.js';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTITUTION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FORM_CONFIGURATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Admissions CRM', () => {
  it('waitlists an application and books an interview slot', async () => {
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

    const submitted = await service.submitRegistration(
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
      'admissions-crm-ada',
    );

    const apps = await service.listApplications(TENANT);
    expect(apps).toHaveLength(1);

    const { application, waitlistEntry } = await service.updateApplicationStatus(
      TENANT,
      apps[0]!.id,
      'waitlisted',
      'Capacity full',
    );
    expect(application.status).toBe('waitlisted');
    expect(waitlistEntry?.position).toBe(1);

    const status = await service.checkStatus(submitted.trackingNumber, '2012-01-01', TENANT);
    expect(status.waitlistPosition).toBe(1);

    const slot = await service.createInterviewSlot(TENANT, {
      institutionId: INSTITUTION,
      startsAt: '2026-09-20T10:00:00.000Z',
      endsAt: '2026-09-20T10:30:00.000Z',
      capacity: 1,
      location: 'Office A',
    });

    const booking = await service.bookInterview(TENANT, {
      slotId: slot.id,
      applicationId: apps[0]!.id,
    });
    expect(booking.status).toBe('booked');

    await expect(
      service.bookInterview(TENANT, {
        slotId: slot.id,
        applicationId: uuidv4(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Capacity full for another known app
    const second = await service.submitRegistration(
      TENANT,
      {
        institutionId: INSTITUTION,
        formConfigurationId: FORM_CONFIGURATION,
        formConfigurationVersion: 1,
        firstName: 'Grace',
        lastName: 'Hopper',
        dateOfBirth: '2011-05-05',
        gender: 'female',
        guardianName: 'Parent2',
        guardianPhone: '+911234567891',
      },
      'admissions-crm-grace',
    );
    const apps2 = await service.listApplications(TENANT);
    const secondApp = apps2.find((row) => row.trackingNumber === second.trackingNumber)!;
    await expect(
      service.bookInterview(TENANT, { slotId: slot.id, applicationId: secondApp.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
