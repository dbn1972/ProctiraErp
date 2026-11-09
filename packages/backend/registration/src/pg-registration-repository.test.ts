/**
 * Unit tests for registration repository factory + pipeline persist (G-205).
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRegistrationRepository,
  isPgRegistrationEnabled,
} from './create-registration-repository.js';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import {
  getSharedRegistrationPool,
  PgRegistrationRepository,
} from './pg-registration-repository.js';
import type { NewRegistrationEntity } from './registration-repository.js';

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
      // Satisfies the opt-in tenant FKs (db/sql/021b) when APPLY_STRICT_FKS=1.
      await withPgTenant(pool!, tenantId, (client) =>
        client.query(
          `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [tenantId, `reg-test-${tenantId.slice(0, 8)}`, `reg-test-${tenantId}`],
        ),
      );
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
        documents: [
          { fileName: 'id.pdf', fileType: 'application/pdf', fileSize: 1024, documentType: 'id' },
        ],
        preferredLanguage: 'en',
        remarks: null,
      });
      expect(created.status).toBe('pending');

      const byTracking = await repo.findByTrackingNumber(trackingNumber, tenantId);
      expect(byTracking?.id).toBe(applicationId);

      const underReview = await repo.updateStatus(
        applicationId,
        'under_review',
        'Staff reviewing',
        tenantId,
      );
      expect(underReview?.status).toBe('under_review');
      expect(underReview?.remarks).toBe('Staff reviewing');

      const waitlisted = await repo.updateStatus(
        applicationId,
        'waitlisted',
        'Capacity full',
        tenantId,
      );
      expect(waitlisted?.status).toBe('waitlisted');

      const listed = await repo.listByTenant(tenantId);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.status).toBe('waitlisted');
      expect(listed[0]?.documents[0]?.fileName).toBe('id.pdf');
    },
  );
});

describe('W1-DATA-13 PgRegistrationRepository denies missing tenant', () => {
  const dummyPool = { query: async () => ({ rows: [] }) };

  it('findByTrackingNumber rejects empty / missing tenantId before querying', async () => {
    const repo = new PgRegistrationRepository(dummyPool as never);
    await expect(repo.findByTrackingNumber('REG-1')).rejects.toThrow(/tenantId is required/);
    await expect(repo.findByTrackingNumber('REG-1', '')).rejects.toThrow(/tenantId is required/);
    await expect(repo.findByTrackingNumber('REG-1', '   ')).rejects.toThrow(/tenantId is required/);
  });

  it('findById rejects empty / missing tenantId before querying', async () => {
    const repo = new PgRegistrationRepository(dummyPool as never);
    await expect(repo.findById('id-1')).rejects.toThrow(/tenantId is required/);
    await expect(repo.findById('id-1', '')).rejects.toThrow(/tenantId is required/);
  });
});

describe('PRC-M568 PgRegistrationRepository.createIdempotent without config row lock', () => {
  const tenantId = randomUUID();
  const institutionId = randomUUID();
  const configurationId = randomUUID();

  function entity(): NewRegistrationEntity {
    return {
      id: randomUUID(),
      tenantId,
      trackingNumber: 'REG-UNIT0001',
      institutionId,
      status: 'pending',
      firstName: 'Asha',
      lastName: 'Rao',
      dateOfBirth: '2018-04-01',
      gender: 'female',
      guardianName: 'Guardian',
      guardianPhone: '+910000000000',
      guardianEmail: null,
      customFields: [],
      documents: [],
      preferredLanguage: null,
      remarks: null,
      formConfigurationId: configurationId,
      formConfigurationVersion: 1,
      submissionKey: 'unit-submission-key',
      submissionPayloadHash: 'a'.repeat(64),
    };
  }

  /** Scripted single-connection pool; `insertError` is thrown by the application INSERT. */
  function scriptedPool(insertError: unknown) {
    const statements: string[] = [];
    const client = {
      query: async (text: string) => {
        statements.push(text);
        if (/^\s*SELECT i\.name AS institution_name/.test(text)) {
          return {
            rows: [
              {
                institution_name: 'Unit School',
                id: configurationId,
                institution_id: institutionId,
                version: 1,
                published_at: new Date('2026-10-01T00:00:00.000Z'),
                fields: [],
              },
            ],
          };
        }
        if (/^\s*INSERT INTO admission_applications/.test(text)) throw insertError;
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = {
      query: async () => ({ rows: [] }),
      end: async () => undefined,
      connect: async () => client,
    };
    return { pool, statements };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('locks only the institution row (no lock clause naming the append-only config table)', async () => {
    vi.spyOn(PgRegistrationRepository.prototype, 'ensureSchema').mockResolvedValue();
    const { pool, statements } = scriptedPool(
      Object.assign(new Error('fk'), {
        code: '23503',
        constraint: 'admission_applications_form_configuration_fkey',
      }),
    );
    await new PgRegistrationRepository(pool as never).createIdempotent(entity());
    const context = statements.find((s) => /SELECT i\.name AS institution_name/.test(s));
    expect(context).toMatch(/FOR KEY SHARE OF i\s*$/);
    expect(context).not.toMatch(/FOR KEY SHARE OF i,/);
  });

  it('maps the form-configuration FK violation to context_unavailable after rolling back', async () => {
    vi.spyOn(PgRegistrationRepository.prototype, 'ensureSchema').mockResolvedValue();
    const { pool, statements } = scriptedPool(
      Object.assign(new Error('insert or update violates foreign key constraint'), {
        code: '23503',
        constraint: 'admission_applications_form_configuration_fkey',
      }),
    );
    await expect(
      new PgRegistrationRepository(pool as never).createIdempotent(entity()),
    ).resolves.toEqual({ outcome: 'context_unavailable' });
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  it('rethrows other foreign-key and privilege errors', async () => {
    vi.spyOn(PgRegistrationRepository.prototype, 'ensureSchema').mockResolvedValue();
    const otherFk = Object.assign(new Error('other fk'), {
      code: '23503',
      constraint: 'admission_applications_tenant_id_fkey',
    });
    const denied = Object.assign(new Error('permission denied'), { code: '42501' });
    await expect(
      new PgRegistrationRepository(scriptedPool(otherFk).pool as never).createIdempotent(entity()),
    ).rejects.toBe(otherFk);
    await expect(
      new PgRegistrationRepository(scriptedPool(denied).pool as never).createIdempotent(entity()),
    ).rejects.toBe(denied);
  });
});
