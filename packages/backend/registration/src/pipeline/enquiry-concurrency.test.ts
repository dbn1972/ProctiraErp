/**
 * PRC-M335 — the in-memory pipeline store mirrors the PG concurrency contract
 * (db/sql/262): optimistic enquiry updates and a claim-first conversion.
 */
import { randomUUID } from 'node:crypto';
import { ConflictError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryRegistrationRepository } from '../in-memory-repository.js';
import { AdmissionsPipelineService } from './pipeline-service.js';
import { InMemoryAdmissionsPipelineStore } from './pipeline-store.js';

const TENANT = randomUUID();

function setup() {
  const store = new InMemoryAdmissionsPipelineStore();
  const applications = new InMemoryRegistrationRepository();
  const service = new AdmissionsPipelineService(store, applications);
  return { store, applications, service };
}

async function enquiry(service: AdmissionsPipelineService) {
  return service.createEnquiry(TENANT, {
    institutionId: randomUUID(),
    academicPeriodId: randomUUID(),
    gradeId: randomUUID(),
    firstName: 'Asha',
    lastName: 'Rao',
    dateOfBirth: '2018-04-01',
    guardianName: 'Guardian',
    guardianPhone: '+910000000000',
  });
}

describe('PRC-M335 enquiry concurrency (in-memory contract)', () => {
  it('concurrent conversions create one application', async () => {
    const { store, applications, service } = setup();
    const created = await enquiry(service);
    const createSpy = vi.spyOn(applications, 'create');

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.convertEnquiry(TENANT, created.id)),
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const stored = await store.findEnquiry(TENANT, created.id);
    expect(stored?.stage).toBe('applied');
    expect(new Set(results.map((r) => r.application.id))).toEqual(new Set([stored?.applicationId]));
  });

  it('releases the claim when the application create fails, so a retry converts', async () => {
    const { store, applications, service } = setup();
    const created = await enquiry(service);
    vi.spyOn(applications, 'create').mockRejectedValueOnce(new Error('boom'));

    await expect(service.convertEnquiry(TENANT, created.id)).rejects.toThrow('boom');
    expect((await store.findEnquiry(TENANT, created.id))?.applicationId).toBeNull();

    const retried = await service.convertEnquiry(TENANT, created.id);
    expect(retried.enquiry.applicationId).toBe(retried.application.id);
  });

  it('rejects a stale-version update and keeps the newer edit', async () => {
    const { store, service } = setup();
    const created = await enquiry(service);
    const original = await store.findEnquiry(TENANT, created.id);

    await service.updateEnquiry(TENANT, created.id, { notes: 'newer' });

    await expect(
      store.updateEnquiry({ ...original!, notes: 'stale' }, original!.version),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await store.findEnquiry(TENANT, created.id))?.notes).toBe('newer');
  });

  it('does not expose the version token in enquiry responses', async () => {
    const { service } = setup();
    const created = await enquiry(service);
    expect(created).not.toHaveProperty('version');
  });
});
