/**
 * G-717 — Postgres admissions CRM store (waitlist + interview slots) on db/sql/014.
 * Pg cases skip when DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import { InMemoryAdmissionsCrmStore } from './admissions-crm-store.js';
import {
  createAdmissionsCrmStore,
  isPgRegistrationEnabled,
} from './create-registration-repository.js';
import { PgAdmissionsCrmStore } from './pg-admissions-crm-store.js';
import {
  getSharedRegistrationPool,
  PgRegistrationRepository,
} from './pg-registration-repository.js';

describe('createAdmissionsCrmStore', () => {
  it('falls back to in-memory when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(createAdmissionsCrmStore()).toBeInstanceOf(InMemoryAdmissionsCrmStore);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });

  it.skipIf(!isPgRegistrationEnabled())('returns the Pg store when DATABASE_URL is set', () => {
    expect(createAdmissionsCrmStore()).toBeInstanceOf(PgAdmissionsCrmStore);
  });
});

async function seedTenant(tenantId: string): Promise<void> {
  // Satisfies the opt-in tenant FKs (db/sql/021b) when APPLY_STRICT_FKS=1.
  await withPgTenant(getSharedRegistrationPool()!, tenantId, (client) =>
    client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `crm-test-${tenantId.slice(0, 8)}`, `crm-test-${tenantId}`],
    ),
  );
}

describe('PgAdmissionsCrmStore', () => {
  async function seedApplication(tenantId: string, institutionId: string): Promise<string> {
    await seedTenant(tenantId);
    const repo = new PgRegistrationRepository(getSharedRegistrationPool()!);
    const id = randomUUID();
    await repo.create({
      id,
      tenantId,
      trackingNumber: `REG-${id.slice(0, 8).toUpperCase()}`,
      institutionId,
      institutionName: 'CRM School',
      status: 'pending',
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '2012-01-01',
      gender: 'female',
      guardianName: 'Parent',
      guardianPhone: '+911234567890',
      guardianEmail: null,
      customFields: [],
      documents: [],
      preferredLanguage: 'en',
      remarks: null,
    });
    return id;
  }

  it.skipIf(!isPgRegistrationEnabled())(
    'assigns monotonic waitlist positions per institution and is idempotent per application',
    async () => {
      const store = new PgAdmissionsCrmStore(getSharedRegistrationPool()!);
      const tenantId = randomUUID();
      const institutionId = randomUUID();
      const appA = await seedApplication(tenantId, institutionId);
      const appB = await seedApplication(tenantId, institutionId);

      const first = await store.enqueueWaitlist({ tenantId, applicationId: appA, institutionId });
      const second = await store.enqueueWaitlist({ tenantId, applicationId: appB, institutionId });
      const again = await store.enqueueWaitlist({ tenantId, applicationId: appA, institutionId });

      expect(first.position).toBe(1);
      expect(second.position).toBe(2);
      expect(again.id).toBe(first.id);

      const list = await store.listWaitlist(tenantId, institutionId);
      expect(list.map((row) => row.applicationId)).toEqual([appA, appB]);
    },
  );

  it.skipIf(!isPgRegistrationEnabled())(
    'creates slots, books idempotently and honours tenant isolation',
    async () => {
      const store = new PgAdmissionsCrmStore(getSharedRegistrationPool()!);
      const tenantId = randomUUID();
      const otherTenant = randomUUID();
      const institutionId = randomUUID();
      const appId = await seedApplication(tenantId, institutionId);

      const slot = await store.createSlot({
        tenantId,
        institutionId,
        startsAt: '2026-10-01T09:00:00.000Z',
        endsAt: '2026-10-01T09:30:00.000Z',
        capacity: 2,
        location: 'Room 1',
      });
      expect(slot.status).toBe('open');
      expect(await store.findSlot(slot.id, tenantId)).not.toBeNull();
      expect(await store.findSlot(slot.id, otherTenant)).toBeNull();
      expect(await store.listSlots(otherTenant, institutionId)).toEqual([]);

      const booking = await store.bookSlot({ tenantId, slotId: slot.id, applicationId: appId });
      const repeat = await store.bookSlot({ tenantId, slotId: slot.id, applicationId: appId });
      expect(repeat.id).toBe(booking.id);

      expect(await store.listBookingsForSlot(tenantId, slot.id)).toHaveLength(1);
      expect(await store.listBookingsForApplication(tenantId, appId)).toHaveLength(1);
      expect(await store.listBookingsForSlot(otherTenant, slot.id)).toEqual([]);
    },
  );
});
