import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { PgPrivacyRepository } from './pg-privacy-repository.js';
import { PrivacyService } from './privacy-service.js';

const TENANT = '5a5a5a5a-0000-4000-8000-0000000000aa';

describe('legal-hold gate issues one indexed lookup (PRC-L138)', () => {
  it('service gates call findActiveHold once and never list all holds', async () => {
    const repo = new InMemoryPrivacyRepository();
    const service = new PrivacyService(repo);
    await service.placeLegalHold({
      tenantId: TENANT,
      scope: 'subject',
      subjectType: 'student',
      subjectId: 'stu-1',
      reason: 'x',
      placedBy: 'counsel',
    });
    const find = vi.spyOn(repo, 'findActiveHold');
    const list = vi.spyOn(repo, 'listActiveLegalHolds');

    await expect(service.assertDestructiveDeleteAllowed(TENANT, 'stu-1')).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    await expect(service.assertDestructiveDeleteAllowed(TENANT, 'stu-2')).resolves.toBeUndefined();
    expect(await service.isOnLegalHold(TENANT, 'student', 'stu-1')).toBe(true);
    expect(await service.isOnLegalHold(TENANT, 'staff', 'stu-1')).toBe(false);
    expect(await service.isOnLegalHold(TENANT)).toBe(false);
    expect(find).toHaveBeenCalledTimes(5);
    expect(list).not.toHaveBeenCalled();
  });

  it('tenant-scope hold blocks any subject', async () => {
    const repo = new InMemoryPrivacyRepository();
    const service = new PrivacyService(repo);
    await service.placeLegalHold({ tenantId: TENANT, scope: 'tenant', reason: 'x', placedBy: 'c' });
    await expect(service.assertDestructiveDeleteAllowed(TENANT, 'anyone')).rejects.toThrow(
      /tenant .* legal hold/,
    );
    expect(await service.isOnLegalHold(TENANT, 'student', 'anyone')).toBe(true);
  });

  it('pg repository runs a single bounded SELECT for the gate', async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: client.query };
    const repo = new PgPrivacyRepository(pool as never);
    vi.spyOn(repo, 'ensureSchema').mockResolvedValue(undefined);
    expect(await repo.findActiveHold(TENANT, { subjectId: 'stu-1' })).toBeNull();
    const selects = queries.filter((q) => /privacy_legal_holds/.test(q));
    expect(selects).toHaveLength(1);
    expect(selects[0]).toMatch(/LIMIT 1/);
    expect(selects[0]).toMatch(/active = true/);
  });
});
