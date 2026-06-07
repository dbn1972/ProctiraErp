/**
 * Unit tests for InMemoryAuditStore.
 *
 * Tests cover:
 * - Appending entries with auto-generated ID and timestamp
 * - Querying with various filters
 * - Partition-based storage (by month)
 * - Append-only semantics (no update/delete exposed)
 * - Pagination support
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryAuditStore } from './in-memory-audit-store.js';
import type { CreateAuditEntryInput } from './types.js';

function createInput(overrides: Partial<CreateAuditEntryInput> = {}): CreateAuditEntryInput {
  return {
    entityType: 'student',
    entityId: 'stu-001',
    tenantId: 'tenant-001',
    userId: 'user-001',
    operation: 'create',
    changes: [{ field: 'name', oldValue: null, newValue: 'John' }],
    ipAddress: '192.168.1.1',
    ...overrides,
  };
}

describe('InMemoryAuditStore', () => {
  let store: InMemoryAuditStore;

  beforeEach(() => {
    store = new InMemoryAuditStore();
  });

  describe('append', () => {
    it('should create an entry with auto-generated ID', async () => {
      const input = createInput();
      const entry = await store.append(input);

      expect(entry.id).toBeDefined();
      expect(entry.id.length).toBeGreaterThan(0);
    });

    it('should create an entry with auto-generated timestamp', async () => {
      const input = createInput();
      const entry = await store.append(input);

      expect(entry.timestamp).toBeDefined();
      // Should be a valid ISO date
      const parsed = new Date(entry.timestamp);
      expect(parsed.toISOString()).toBe(entry.timestamp);
    });

    it('should preserve all input fields in the entry', async () => {
      const input = createInput({
        entityType: 'enrollment',
        entityId: 'enr-123',
        tenantId: 'tenant-xyz',
        userId: 'admin-user',
        operation: 'update',
        changes: [{ field: 'status', oldValue: 'enrolled', newValue: 'transferred' }],
        ipAddress: '10.0.0.1',
      });

      const entry = await store.append(input);

      expect(entry.entityType).toBe('enrollment');
      expect(entry.entityId).toBe('enr-123');
      expect(entry.tenantId).toBe('tenant-xyz');
      expect(entry.userId).toBe('admin-user');
      expect(entry.operation).toBe('update');
      expect(entry.changes).toEqual([{ field: 'status', oldValue: 'enrolled', newValue: 'transferred' }]);
      expect(entry.ipAddress).toBe('10.0.0.1');
    });

    it('should assign unique IDs to different entries', async () => {
      const entry1 = await store.append(createInput());
      const entry2 = await store.append(createInput());

      expect(entry1.id).not.toBe(entry2.id);
    });

    it('should store entries in monthly partitions', async () => {
      await store.append(createInput());

      expect(store.getPartitionCount()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('query', () => {
    it('should return all entries when no filter is provided', async () => {
      await store.append(createInput({ entityId: 'stu-1' }));
      await store.append(createInput({ entityId: 'stu-2' }));
      await store.append(createInput({ entityId: 'stu-3' }));

      const results = await store.query({});

      expect(results).toHaveLength(3);
    });

    it('should filter by entityType', async () => {
      await store.append(createInput({ entityType: 'student' }));
      await store.append(createInput({ entityType: 'enrollment' }));
      await store.append(createInput({ entityType: 'student' }));

      const results = await store.query({ entityType: 'student' });

      expect(results).toHaveLength(2);
      results.forEach((e) => expect(e.entityType).toBe('student'));
    });

    it('should filter by entityId', async () => {
      await store.append(createInput({ entityId: 'stu-1' }));
      await store.append(createInput({ entityId: 'stu-2' }));

      const results = await store.query({ entityId: 'stu-1' });

      expect(results).toHaveLength(1);
      expect(results[0].entityId).toBe('stu-1');
    });

    it('should filter by tenantId', async () => {
      await store.append(createInput({ tenantId: 'tenant-A' }));
      await store.append(createInput({ tenantId: 'tenant-B' }));

      const results = await store.query({ tenantId: 'tenant-A' });

      expect(results).toHaveLength(1);
      expect(results[0].tenantId).toBe('tenant-A');
    });

    it('should filter by userId', async () => {
      await store.append(createInput({ userId: 'user-A' }));
      await store.append(createInput({ userId: 'user-B' }));

      const results = await store.query({ userId: 'user-A' });

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe('user-A');
    });

    it('should filter by operation', async () => {
      await store.append(createInput({ operation: 'create' }));
      await store.append(createInput({ operation: 'update' }));
      await store.append(createInput({ operation: 'delete' }));

      const results = await store.query({ operation: 'update' });

      expect(results).toHaveLength(1);
      expect(results[0].operation).toBe('update');
    });

    it('should support limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await store.append(createInput({ entityId: `stu-${i}` }));
      }

      const results = await store.query({}, 3);

      expect(results).toHaveLength(3);
    });

    it('should support offset parameter for pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await store.append(createInput({ entityId: `stu-${i}` }));
      }

      const page1 = await store.query({}, 2, 0);
      const page2 = await store.query({}, 2, 2);

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      // Pages should not overlap
      const page1Ids = page1.map((e) => e.id);
      const page2Ids = page2.map((e) => e.id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });

    it('should return results ordered by timestamp descending', async () => {
      await store.append(createInput({ entityId: 'stu-1' }));
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.append(createInput({ entityId: 'stu-2' }));

      const results = await store.query({});

      // Most recent first
      expect(results[0].timestamp >= results[1].timestamp).toBe(true);
    });
  });

  describe('count', () => {
    it('should count all entries when no filter is provided', async () => {
      await store.append(createInput());
      await store.append(createInput());
      await store.append(createInput());

      const count = await store.count({});

      expect(count).toBe(3);
    });

    it('should count entries matching a filter', async () => {
      await store.append(createInput({ entityType: 'student' }));
      await store.append(createInput({ entityType: 'enrollment' }));
      await store.append(createInput({ entityType: 'student' }));

      const count = await store.count({ entityType: 'student' });

      expect(count).toBe(2);
    });
  });

  describe('findById', () => {
    it('should find an entry by its ID', async () => {
      const created = await store.append(createInput());

      const found = await store.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('should return null for non-existent ID', async () => {
      const found = await store.findById('non-existent');

      expect(found).toBeNull();
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      await store.append(createInput());
      await store.append(createInput());

      store.clear();

      expect(store.getTotalEntryCount()).toBe(0);
      expect(store.getPartitionCount()).toBe(0);
    });
  });
});
