/**
 * Unit tests for AuditService.
 *
 * Tests cover:
 * - Recording create, update, and delete operations
 * - Capturing changed fields, previous/new values, timestamp, user
 * - Skipping audit entry when no changes detected on update
 * - Querying audit entries with filters
 * - Append-only semantics (entries stored in partitioned store)
 *
 * Requirements:
 * - 6.6: Complete audit trail of all changes to student records
 * - 21.1: Record audit log entry for every create, update, delete
 * - 21.2: Log authenticated user, timestamp, IP address, affected entity
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { AuditService } from './audit-service.js';
import { InMemoryAuditStore } from './in-memory-audit-store.js';
import type { AuditContext } from './audit-service.js';

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-001';
const IP_ADDRESS = '192.168.1.100';

function createContext(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    ipAddress: IP_ADDRESS,
    ...overrides,
  };
}

describe('AuditService', () => {
  let store: InMemoryAuditStore;
  let service: AuditService;

  beforeEach(() => {
    store = new InMemoryAuditStore();
    service = new AuditService(store);
  });

  describe('recordCreate', () => {
    it('should record a create operation with all new field values', async () => {
      const context = createContext();
      const newState = {
        id: 'student-001',
        name: 'John Doe',
        dateOfBirth: '2005-03-15',
        gender: 'male',
      };

      const entry = await service.recordCreate(context, 'student', 'student-001', newState);

      expect(entry).toBeDefined();
      expect(entry.entityType).toBe('student');
      expect(entry.entityId).toBe('student-001');
      expect(entry.tenantId).toBe(TENANT_ID);
      expect(entry.userId).toBe(USER_ID);
      expect(entry.ipAddress).toBe(IP_ADDRESS);
      expect(entry.operation).toBe('create');
      expect(entry.timestamp).toBeDefined();
      expect(entry.id).toBeDefined();

      // All fields should appear as changes (oldValue = null)
      expect(entry.changes).toHaveLength(4);
      expect(entry.changes).toContainEqual({
        field: 'dateOfBirth',
        oldValue: null,
        newValue: '2005-03-15',
      });
      expect(entry.changes).toContainEqual({ field: 'gender', oldValue: null, newValue: 'male' });
      expect(entry.changes).toContainEqual({
        field: 'id',
        oldValue: null,
        newValue: 'student-001',
      });
      expect(entry.changes).toContainEqual({ field: 'name', oldValue: null, newValue: 'John Doe' });
    });

    it('should capture the authenticated user and IP address', async () => {
      const context = createContext({ userId: 'admin-user', ipAddress: '10.0.0.1' });
      const newState = { name: 'Test Student' };

      const entry = await service.recordCreate(context, 'student', 'stu-1', newState);

      expect(entry.userId).toBe('admin-user');
      expect(entry.ipAddress).toBe('10.0.0.1');
    });

    it('should generate a valid ISO timestamp', async () => {
      const context = createContext();
      const newState = { name: 'Test' };

      const entry = await service.recordCreate(context, 'student', 'stu-1', newState);

      // Verify it's a valid ISO date
      const parsed = new Date(entry.timestamp);
      expect(parsed.toISOString()).toBe(entry.timestamp);
    });
  });

  describe('recordUpdate', () => {
    it('should record only the changed fields', async () => {
      const context = createContext();
      const oldState = { name: 'John Doe', age: 18, city: 'NYC' };
      const newState = { name: 'John Smith', age: 18, city: 'NYC' };

      const entry = await service.recordUpdate(context, 'student', 'stu-1', oldState, newState);

      expect(entry).not.toBeNull();
      expect(entry!.operation).toBe('update');
      expect(entry!.changes).toHaveLength(1);
      expect(entry!.changes[0]).toEqual({
        field: 'name',
        oldValue: 'John Doe',
        newValue: 'John Smith',
      });
    });

    it('should capture previous and new values for each changed field', async () => {
      const context = createContext();
      const oldState = { firstName: 'John', lastName: 'Doe', email: 'john@old.com' };
      const newState = { firstName: 'John', lastName: 'Smith', email: 'john@new.com' };

      const entry = await service.recordUpdate(context, 'student', 'stu-1', oldState, newState);

      expect(entry!.changes).toHaveLength(2);
      expect(entry!.changes).toContainEqual({
        field: 'email',
        oldValue: 'john@old.com',
        newValue: 'john@new.com',
      });
      expect(entry!.changes).toContainEqual({
        field: 'lastName',
        oldValue: 'Doe',
        newValue: 'Smith',
      });
    });

    it('should return null when no changes are detected', async () => {
      const context = createContext();
      const state = { name: 'John', age: 20 };

      const entry = await service.recordUpdate(context, 'student', 'stu-1', state, state);

      expect(entry).toBeNull();
    });

    it('should support partial comparison for partial updates', async () => {
      const context = createContext();
      const oldState = { name: 'John', age: 20, city: 'NYC', country: 'US' };
      const newState = { name: 'Jane' };

      const entry = await service.recordUpdate(context, 'student', 'stu-1', oldState, newState, {
        partialComparison: true,
      });

      expect(entry!.changes).toHaveLength(1);
      expect(entry!.changes[0]).toEqual({ field: 'name', oldValue: 'John', newValue: 'Jane' });
    });

    it('should exclude specified fields from audit', async () => {
      const context = createContext();
      const oldState = { name: 'John', internalVersion: 1 };
      const newState = { name: 'Jane', internalVersion: 2 };

      const entry = await service.recordUpdate(context, 'student', 'stu-1', oldState, newState, {
        excludeFields: ['internalVersion'],
      });

      expect(entry!.changes).toHaveLength(1);
      expect(entry!.changes[0].field).toBe('name');
    });
  });

  describe('recordDelete', () => {
    it('should record a delete operation with all previous field values', async () => {
      const context = createContext();
      const oldState = { name: 'John Doe', age: 18 };

      const entry = await service.recordDelete(context, 'student', 'stu-1', oldState);

      expect(entry).toBeDefined();
      expect(entry.operation).toBe('delete');
      expect(entry.changes).toHaveLength(2);
      expect(entry.changes).toContainEqual({ field: 'age', oldValue: 18, newValue: null });
      expect(entry.changes).toContainEqual({ field: 'name', oldValue: 'John Doe', newValue: null });
    });
  });

  describe('query', () => {
    it('should query entries by entity type', async () => {
      const context = createContext();
      await service.recordCreate(context, 'student', 'stu-1', { name: 'A' });
      await service.recordCreate(context, 'enrollment', 'enr-1', { status: 'enrolled' });
      await service.recordCreate(context, 'student', 'stu-2', { name: 'B' });

      const results = await service.query({ entityType: 'student' });

      expect(results).toHaveLength(2);
      results.forEach((entry) => expect(entry.entityType).toBe('student'));
    });

    it('should query entries by user ID', async () => {
      const context1 = createContext({ userId: 'user-A' });
      const context2 = createContext({ userId: 'user-B' });
      await service.recordCreate(context1, 'student', 'stu-1', { name: 'A' });
      await service.recordCreate(context2, 'student', 'stu-2', { name: 'B' });

      const results = await service.query({ userId: 'user-A' });

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe('user-A');
    });

    it('should query entries by operation type', async () => {
      const context = createContext();
      await service.recordCreate(context, 'student', 'stu-1', { name: 'A' });
      await service.recordUpdate(context, 'student', 'stu-1', { name: 'A' }, { name: 'B' });
      await service.recordDelete(context, 'student', 'stu-1', { name: 'B' });

      const creates = await service.query({ operation: 'create' });
      const updates = await service.query({ operation: 'update' });
      const deletes = await service.query({ operation: 'delete' });

      expect(creates).toHaveLength(1);
      expect(updates).toHaveLength(1);
      expect(deletes).toHaveLength(1);
    });

    it('should query entries by tenant ID', async () => {
      const context1 = createContext({ tenantId: 'tenant-A' });
      const context2 = createContext({ tenantId: 'tenant-B' });
      await service.recordCreate(context1, 'student', 'stu-1', { name: 'A' });
      await service.recordCreate(context2, 'student', 'stu-2', { name: 'B' });

      const results = await service.query({ tenantId: 'tenant-A' });

      expect(results).toHaveLength(1);
      expect(results[0].tenantId).toBe('tenant-A');
    });

    it('should support pagination with limit and offset', async () => {
      const context = createContext();
      for (let i = 0; i < 5; i++) {
        await service.recordCreate(context, 'student', `stu-${i}`, { name: `Student ${i}` });
      }

      const page1 = await service.query({}, 2, 0);
      const page2 = await service.query({}, 2, 2);

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
    });
  });

  describe('count', () => {
    it('should count entries matching a filter', async () => {
      const context = createContext();
      await service.recordCreate(context, 'student', 'stu-1', { name: 'A' });
      await service.recordCreate(context, 'student', 'stu-2', { name: 'B' });
      await service.recordCreate(context, 'enrollment', 'enr-1', { status: 'enrolled' });

      const count = await service.count({ entityType: 'student' });

      expect(count).toBe(2);
    });
  });

  describe('findById', () => {
    it('should find an entry by its ID', async () => {
      const context = createContext();
      const created = await service.recordCreate(context, 'student', 'stu-1', { name: 'John' });

      const found = await service.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.entityType).toBe('student');
    });

    it('should return null for non-existent ID', async () => {
      const found = await service.findById('non-existent-id');

      expect(found).toBeNull();
    });
  });

  describe('append-only semantics', () => {
    it('should store entries in the store without modification capability', async () => {
      const context = createContext();
      await service.recordCreate(context, 'student', 'stu-1', { name: 'John' });
      await service.recordUpdate(context, 'student', 'stu-1', { name: 'John' }, { name: 'Jane' });

      // Verify entries are stored
      expect(store.getTotalEntryCount()).toBe(2);
    });

    it('should assign unique IDs to each entry', async () => {
      const context = createContext();
      const entry1 = await service.recordCreate(context, 'student', 'stu-1', { name: 'A' });
      const entry2 = await service.recordCreate(context, 'student', 'stu-2', { name: 'B' });

      expect(entry1.id).not.toBe(entry2.id);
    });
  });
});
