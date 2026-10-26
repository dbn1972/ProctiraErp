import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheClient, tenantKey } from '@proctira/cache';

import { CachedWorkflowRepository } from './cached-workflow-repository.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';

const TENANT_ID = 'tenant-001';

function createJsonRoundTripCache(): CacheClient {
  const store = new Map<string, string>();
  const mockRedis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    }),
    scan: vi.fn(async () => ['0', []] as [string, string[]]),
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => 'OK'),
  };
  return new CacheClient({ redis: mockRedis as unknown as import('ioredis').default });
}

const definitionInput = {
  id: 'wf-1',
  tenantId: TENANT_ID,
  name: 'Test Workflow',
  entityType: 'student_transfer',
  description: null,
  states: [
    {
      id: 'draft',
      name: 'Draft',
      type: 'INITIAL' as const,
      assigneeType: 'user',
      assigneeId: 'u1',
    },
    { id: 'done', name: 'Done', type: 'FINAL' as const, assigneeType: 'role', assigneeId: 'admin' },
  ],
  transitions: [{ id: 't1', fromStateId: 'draft', toStateId: 'done', action: 'submit' }],
  escalationRules: null,
};

describe('CachedWorkflowRepository', () => {
  let delegate: InMemoryWorkflowRepository;
  let cache: CacheClient;
  let repository: CachedWorkflowRepository;

  beforeEach(() => {
    delegate = new InMemoryWorkflowRepository();
    cache = createJsonRoundTripCache();
    repository = new CachedWorkflowRepository(delegate, cache);
  });

  it('calls the delegate once and revives Date fields on cache hit', async () => {
    const created = await delegate.createDefinition(definitionInput);
    const spy = vi.spyOn(delegate, 'findDefinitionById');

    const first = await repository.findDefinitionById('wf-1', TENANT_ID);
    const second = await repository.findDefinitionById('wf-1', TENANT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first!.createdAt.toISOString()).toBe(created.createdAt.toISOString());
    expect(second!.createdAt).toBeInstanceOf(Date);
    expect(second!.updatedAt).toBeInstanceOf(Date);
    expect(second!.createdAt.toISOString()).toBe(created.createdAt.toISOString());
  });

  it('passes null through on miss without caching it', async () => {
    const spy = vi.spyOn(delegate, 'findDefinitionById');

    const first = await repository.findDefinitionById('missing', TENANT_ID);
    const second = await repository.findDefinitionById('missing', TENANT_ID);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('never writes a "not found" result to the cache (PRC-L598)', async () => {
    const setSpy = vi.spyOn(cache, 'set');
    const result = await repository.findDefinitionById('unknown-id', TENANT_ID);
    expect(result).toBeNull();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('caches a found definition on read-through (PRC-L598)', async () => {
    await delegate.createDefinition(definitionInput);
    const setSpy = vi.spyOn(cache, 'set');
    await repository.findDefinitionById('wf-1', TENANT_ID);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy.mock.calls[0]?.[0]).toBe(tenantKey(TENANT_ID, 'workflow-definition', 'wf-1'));
  });

  it('invalidates a stale cache entry for the id on create (PRC-L598)', async () => {
    const key = tenantKey(TENANT_ID, 'workflow-definition', 'wf-1');
    await cache.set(key, { ...definitionInput, name: 'Stale Workflow' }, 600);
    const delSpy = vi.spyOn(cache, 'del');

    await repository.createDefinition(definitionInput);

    expect(delSpy).toHaveBeenCalledWith(key);
    const afterCreate = await repository.findDefinitionById('wf-1', TENANT_ID);
    expect(afterCreate!.name).toBe('Test Workflow');
  });

  it('invalidates the cache entry on update', async () => {
    await delegate.createDefinition(definitionInput);
    const spy = vi.spyOn(delegate, 'findDefinitionById');

    await repository.findDefinitionById('wf-1', TENANT_ID);
    await repository.updateDefinition('wf-1', TENANT_ID, { name: 'Updated Workflow' });
    spy.mockClear();

    const afterUpdate = await repository.findDefinitionById('wf-1', TENANT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(afterUpdate!.name).toBe('Updated Workflow');
    expect(afterUpdate!.createdAt).toBeInstanceOf(Date);
  });
});
