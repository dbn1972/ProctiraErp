/**
 * Unit tests for registration repository factory + pipeline persist (G-205).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createRegistrationRepository,
  isPgRegistrationEnabled,
} from './create-registration-repository.js';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import {
  getSharedRegistrationPool,
  PgRegistrationRepository,
} from './pg-registration-repository.js';

describe('createRegistrationRepository', () => {
  it('falls back to in-memory when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(isPgRegistrationEnabled()).toBe(false);
      expect(createRegistrationRepository()).toBeInstanceOf(InMemoryRegistrationRepository);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });
});

describe('PgRegistrationRepository pipeline persist', () => {
  it.skipIf(!isPgRegistrationEnabled())(
    'creates application and persists status pipeline stages',
    async () => {
      const pool = getSharedRegistrationPool();
      expect(pool).not.toBeNull();
      const repo = new PgRegistrationRepository(pool!);
      const tenantId = randomUUID();
      const institutionId = randomUUID();
      const applicationId = randomUUID();
      const trackingNumber = `REG-${applicationId.slice(0, 8).toUpperCase()}`;

      const created = await repo.create({
        id: applicationId,
        tenantId,
        trackingNumber,
        institutionId,
        institutionName: 'Pipeline School',
        status: 'pending',
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2012-01-01',
        gender: 'female',
        guardianName: 'Parent',
        guardianPhone: '+911234567890',
        guardianEmail: null,
        customFields: [],
        documents: [{ fileName: 'id.pdf', fileType: 'application/pdf', fileSize: 1024, documentType: 'id' }],
        preferredLanguage: 'en',
        remarks: null,
      });
      expect(created.status).toBe('pending');

      const byTracking = await repo.findByTrackingNumber(trackingNumber);
      expect(byTracking?.id).toBe(applicationId);

      const underReview = await repo.updateStatus(applicationId, 'under_review', 'Staff reviewing');
      expect(underReview?.status).toBe('under_review');
      expect(underReview?.remarks).toBe('Staff reviewing');

      const waitlisted = await repo.updateStatus(applicationId, 'waitlisted', 'Capacity full');
      expect(waitlisted?.status).toBe('waitlisted');

      const listed = await repo.listByTenant(tenantId);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.status).toBe('waitlisted');
      expect(listed[0]?.documents[0]?.fileName).toBe('id.pdf');
    },
  );
});
