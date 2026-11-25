/**
 * PRC-L115: PHI write audit entries carry a real actor and the names (never the
 * values) of the submitted fields (topic 7 Option A).
 *
 * Before the fix, routes.ts buildPhiWriteAuditBinder fell back to the actor
 * 'anonymous' and wrote `beforeValues: null` and an `afterValues` with ids only.
 */
import type { PgQueryable } from '@proctira/database';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appended = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@proctira/backend-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/backend-audit')>();
  return {
    ...actual,
    appendAuditEntryOnClient: vi.fn(async (_client: unknown, input: Record<string, unknown>) => {
      appended.push(input);
    }),
  };
});

import type { AllergyEntity } from './health-repository.js';
import { healthPlugin } from './health-plugin.js';
import type { HealthAccessContext } from './health-service.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';

type AuditOptions = {
  appendAuditInTxn?: (client: PgQueryable, entity: AllergyEntity) => Promise<void>;
};

/** Runs the audit hook the way the Postgres store does (same client, after the write). */
class AuditingRepository extends InMemoryHealthRepository {
  private readonly client = { query: vi.fn() } as unknown as PgQueryable;

  override async createAllergy(
    data: Omit<AllergyEntity, 'createdAt' | 'updatedAt'>,
    options?: AuditOptions,
  ): Promise<AllergyEntity> {
    const entity = await super.createAllergy(data);
    await options?.appendAuditInTxn?.(this.client, entity);
    return entity;
  }

  override async updateAllergy(
    id: string,
    tenantId: string,
    data: Partial<AllergyEntity>,
    options?: AuditOptions,
  ): Promise<AllergyEntity | null> {
    const entity = await super.updateAllergy(id, tenantId, data);
    if (entity) await options?.appendAuditInTxn?.(this.client, entity);
    return entity;
  }
}

const STUDENT_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('PRC-L115: PHI write audit actor and field names', () => {
  let app: FastifyInstance;
  let repository: AuditingRepository;
  let context: HealthAccessContext;

  beforeEach(async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://unused.invalid/phi-audit-test');
    appended.length = 0;
    repository = new AuditingRepository();
    context = { userId: 'nurse-admin-1', roles: ['health_admin'], guardianOfStudentIds: [] };
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('healthAccessContext', undefined);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = 'tenant-001';
      (request as unknown as { healthAccessContext: HealthAccessContext }).healthAccessContext =
        context;
    });
    await app.register(healthPlugin, { repository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('records the actor and the submitted field names, never field values', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/health/allergies',
      payload: {
        studentId: STUDENT_ID,
        allergyType: 'food',
        description: 'Peanuts',
        severity: 'severe',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    const updated = await app.inject({
      method: 'PUT',
      url: `/health/allergies/${id}`,
      payload: { description: 'Tree nuts' },
    });
    expect(updated.statusCode).toBe(200);

    expect(appended).toHaveLength(2);
    const [createEntry, updateEntry] = appended;
    expect(createEntry).toMatchObject({
      userId: 'nurse-admin-1',
      operation: 'CREATE',
      beforeValues: null,
      afterValues: {
        allergyId: id,
        fields: ['allergyType', 'description', 'severity', 'studentId'],
      },
    });
    expect(updateEntry).toMatchObject({
      userId: 'nurse-admin-1',
      operation: 'UPDATE',
      beforeValues: { allergyId: id },
      afterValues: { allergyId: id, fields: ['description'] },
    });
    const serialized = JSON.stringify(appended);
    expect(serialized).not.toContain('anonymous');
    expect(serialized).not.toContain('Peanuts');
    expect(serialized).not.toContain('Tree nuts');
  });

  it('refuses a PHI write without an authenticated actor (401) and writes nothing', async () => {
    context = {
      userId: undefined as unknown as string,
      roles: ['health_admin'],
      guardianOfStudentIds: [],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/health/allergies',
      payload: {
        studentId: STUDENT_ID,
        allergyType: 'food',
        description: 'Peanuts',
        severity: 'severe',
      },
    });
    expect(res.statusCode).toBe(401);
    expect(appended).toHaveLength(0);
    expect(await repository.listAllAllergies('tenant-001')).toHaveLength(0);
  });
});
