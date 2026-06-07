/**
 * Audit Service Unit Tests
 *
 * Tests the business logic of the audit service including:
 * - Recording audit entries for CREATE/UPDATE/DELETE operations
 * - Validation of operation-specific constraints
 * - Query filtering
 * - Retention configuration
 * - Archival execution
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationError, BusinessRuleError, NotFoundError } from '@proctira/common';

import { AuditService } from './audit-service.js';
import { InMemoryAuditRepository } from './in-memory-repository.js';
import type { RecordAuditInput } from './audit-service.js';

describe('AuditService', () => {
  let service: AuditService;
  let repository: InMemoryAuditRepository;

  beforeEach(() => {
    repository = new InMemoryAuditRepository();
    service = new AuditService(repository);
  });

  describe('recordAudit', () => {
    it('should record a CREATE audit entry with afterValues', async () => {
      const input: RecordAuditInput = {
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-123',
        operation: 'CREATE',
        userId: 'user-1',
        userName: 'Admin User',
        ipAddress: '192.168.1.1',
        afterValues: { name: 'John Doe', grade: '10' },
      };

      const entry = await service.recordAudit(input);

      expect(entry.id).toBeDefined();
      expect(entry.tenantId).toBe('tenant-1');
      expect(entry.entityType).toBe('student');
      expect(entry.entityId).toBe('student-123');
      expect(entry.operation).toBe('CREATE');
      expect(entry.userId).toBe('user-1');
      expect(entry.userName).toBe('Admin User');
      expect(entry.ipAddress).toBe('192.168.1.1');
      expect(entry.timestamp).toBeInstanceOf(Date);
      expect(entry.beforeValues).toBeNull();
      expect(entry.afterValues).toEqual({ name: 'John Doe', grade: '10' });
    });

    it('should record an UPDATE audit entry with before and after values', async () => {
      const input: RecordAuditInput = {
        tenantId: 'tenant-1',
        entityType: 'institution',
        entityId: 'inst-456',
        operation: 'UPDATE',
        userId: 'user-2',
        userName: 'Editor',
        ipAddress: '10.0.0.1',
        beforeValues: { name: 'Old School', status: 'active' },
        afterValues: { name: 'New School', status: 'active' },
      };

      const entry = await service.recordAudit(input);

      expect(entry.operation).toBe('UPDATE');
      expect(entry.beforeValues).toEqual({ name: 'Old School', status: 'active' });
      expect(entry.afterValues).toEqual({ name: 'New School', status: 'active' });
    });

    it('should record a DELETE audit entry with beforeValues', async () => {
      const input: RecordAuditInput = {
        tenantId: 'tenant-1',
        entityType: 'staff',
        entityId: 'staff-789',
        operation: 'DELETE',
        userId: 'user-3',
        userName: 'Admin',
        ipAddress: '172.16.0.1',
        beforeValues: { name: 'Jane Smith', role: 'teacher' },
      };

      const entry = await service.recordAudit(input);

      expect(entry.operation).toBe('DELETE');
      expect(entry.beforeValues).toEqual({ name: 'Jane Smith', role: 'teacher' });
      expect(entry.afterValues).toBeNull();
    });

    it('should reject CREATE with non-null beforeValues', async () => {
      const input: RecordAuditInput = {
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-123',
        operation: 'CREATE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        beforeValues: { name: 'should not exist' },
        afterValues: { name: 'John' },
      };

      await expect(service.recordAudit(input)).rejects.toThrow(ValidationError);
    });

    it('should reject DELETE with non-null afterValues', async () => {
      const input: RecordAuditInput = {
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-123',
        operation: 'DELETE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        beforeValues: { name: 'John' },
        afterValues: { name: 'should not exist' },
      };

      await expect(service.recordAudit(input)).rejects.toThrow(ValidationError);
    });

    it('should reject UPDATE without beforeValues', async () => {
      const input: RecordAuditInput = {
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-123',
        operation: 'UPDATE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        afterValues: { name: 'John' },
      };

      await expect(service.recordAudit(input)).rejects.toThrow(ValidationError);
    });

    it('should reject UPDATE without afterValues', async () => {
      const input: RecordAuditInput = {
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-123',
        operation: 'UPDATE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        beforeValues: { name: 'John' },
      };

      await expect(service.recordAudit(input)).rejects.toThrow(ValidationError);
    });

    it('should reject input with missing required fields', async () => {
      const input = {
        tenantId: '',
        entityType: '',
        entityId: '',
        operation: 'CREATE' as const,
        userId: '',
        userName: 'Admin',
        ipAddress: '',
        afterValues: { name: 'test' },
      };

      await expect(service.recordAudit(input)).rejects.toThrow(ValidationError);
    });
  });

  describe('recordAuditBatch', () => {
    it('should record multiple audit entries', async () => {
      const inputs: RecordAuditInput[] = [
        {
          tenantId: 'tenant-1',
          entityType: 'student',
          entityId: 'student-1',
          operation: 'CREATE',
          userId: 'user-1',
          userName: 'Admin',
          ipAddress: '192.168.1.1',
          afterValues: { name: 'Student 1' },
        },
        {
          tenantId: 'tenant-1',
          entityType: 'student',
          entityId: 'student-2',
          operation: 'CREATE',
          userId: 'user-1',
          userName: 'Admin',
          ipAddress: '192.168.1.1',
          afterValues: { name: 'Student 2' },
        },
      ];

      const entries = await service.recordAuditBatch(inputs);

      expect(entries).toHaveLength(2);
      expect(entries[0]!.entityId).toBe('student-1');
      expect(entries[1]!.entityId).toBe('student-2');
    });
  });

  describe('queryAuditLogs', () => {
    beforeEach(async () => {
      // Seed some audit entries
      await service.recordAudit({
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-1',
        operation: 'CREATE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        afterValues: { name: 'Student 1' },
      });
      await service.recordAudit({
        tenantId: 'tenant-1',
        entityType: 'institution',
        entityId: 'inst-1',
        operation: 'UPDATE',
        userId: 'user-2',
        userName: 'Editor',
        ipAddress: '10.0.0.1',
        beforeValues: { name: 'Old' },
        afterValues: { name: 'New' },
      });
      await service.recordAudit({
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-2',
        operation: 'DELETE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        beforeValues: { name: 'Student 2' },
      });
      await service.recordAudit({
        tenantId: 'tenant-2',
        entityType: 'student',
        entityId: 'student-3',
        operation: 'CREATE',
        userId: 'user-3',
        userName: 'Other Admin',
        ipAddress: '172.16.0.1',
        afterValues: { name: 'Student 3' },
      });
    });

    it('should return all entries for a tenant', async () => {
      const result = await service.queryAuditLogs({ tenantId: 'tenant-1' });

      expect(result.data).toHaveLength(3);
      expect(result.meta.totalItems).toBe(3);
    });

    it('should filter by entity type', async () => {
      const result = await service.queryAuditLogs({
        tenantId: 'tenant-1',
        entityType: 'student',
      });

      expect(result.data).toHaveLength(2);
      expect(result.data.every(e => e.entityType === 'student')).toBe(true);
    });

    it('should filter by operation', async () => {
      const result = await service.queryAuditLogs({
        tenantId: 'tenant-1',
        operation: 'CREATE',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.operation).toBe('CREATE');
    });

    it('should filter by userId', async () => {
      const result = await service.queryAuditLogs({
        tenantId: 'tenant-1',
        userId: 'user-1',
      });

      expect(result.data).toHaveLength(2);
      expect(result.data.every(e => e.userId === 'user-1')).toBe(true);
    });

    it('should isolate by tenant', async () => {
      const result = await service.queryAuditLogs({ tenantId: 'tenant-2' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.tenantId).toBe('tenant-2');
    });

    it('should paginate results', async () => {
      const result = await service.queryAuditLogs({
        tenantId: 'tenant-1',
        page: 1,
        pageSize: 2,
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.pageSize).toBe(2);
      expect(result.meta.totalItems).toBe(3);
      expect(result.meta.totalPages).toBe(2);
    });

    it('should reject invalid date range', async () => {
      await expect(
        service.queryAuditLogs({
          tenantId: 'tenant-1',
          startDate: '2024-12-31',
          endDate: '2024-01-01',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should cap pageSize at 100', async () => {
      const result = await service.queryAuditLogs({
        tenantId: 'tenant-1',
        pageSize: 200,
      });

      expect(result.meta.pageSize).toBe(100);
    });
  });

  describe('getAuditEntry', () => {
    it('should return an entry by ID', async () => {
      const created = await service.recordAudit({
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-1',
        operation: 'CREATE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        afterValues: { name: 'Test' },
      });

      const entry = await service.getAuditEntry('tenant-1', created.id);

      expect(entry.id).toBe(created.id);
      expect(entry.entityType).toBe('student');
    });

    it('should throw NotFoundError for non-existent entry', async () => {
      await expect(
        service.getAuditEntry('tenant-1', 'non-existent-id'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('retention configuration', () => {
    it('should return default config when none is set', async () => {
      const config = await service.getRetentionConfig('tenant-1');

      expect(config.tenantId).toBe('tenant-1');
      expect(config.retentionMonths).toBe(84); // 7 years default
      expect(config.archivalEnabled).toBe(false);
      expect(config.archivalDestination).toBeNull();
    });

    it('should set and retrieve retention config', async () => {
      await service.setRetentionConfig({
        tenantId: 'tenant-1',
        retentionMonths: 24,
        archivalEnabled: true,
        archivalDestination: 's3://audit-archive/tenant-1/',
      });

      const config = await service.getRetentionConfig('tenant-1');

      expect(config.retentionMonths).toBe(24);
      expect(config.archivalEnabled).toBe(true);
      expect(config.archivalDestination).toBe('s3://audit-archive/tenant-1/');
    });

    it('should reject retention months less than 1', async () => {
      await expect(
        service.setRetentionConfig({
          tenantId: 'tenant-1',
          retentionMonths: 0,
          archivalEnabled: false,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject retention months greater than 120', async () => {
      await expect(
        service.setRetentionConfig({
          tenantId: 'tenant-1',
          retentionMonths: 121,
          archivalEnabled: false,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject archival enabled without destination', async () => {
      await expect(
        service.setRetentionConfig({
          tenantId: 'tenant-1',
          retentionMonths: 24,
          archivalEnabled: true,
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('archival', () => {
    it('should throw error when no retention config exists', async () => {
      await expect(service.executeArchival('tenant-1')).rejects.toThrow(BusinessRuleError);
    });

    it('should throw error when archival is not enabled', async () => {
      await service.setRetentionConfig({
        tenantId: 'tenant-1',
        retentionMonths: 12,
        archivalEnabled: false,
      });

      await expect(service.executeArchival('tenant-1')).rejects.toThrow(BusinessRuleError);
    });

    it('should archive expired entries', async () => {
      // Set retention to 1 month
      await service.setRetentionConfig({
        tenantId: 'tenant-1',
        retentionMonths: 1,
        archivalEnabled: true,
        archivalDestination: 's3://archive/',
      });

      // Create an old entry directly in the repository
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 3);

      await repository.create({
        id: 'old-entry-1',
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-old',
        operation: 'CREATE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        timestamp: oldDate,
        beforeValues: null,
        afterValues: { name: 'Old Student' },
        metadata: null,
      });

      // Create a recent entry
      await service.recordAudit({
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-new',
        operation: 'CREATE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        afterValues: { name: 'New Student' },
      });

      const result = await service.executeArchival('tenant-1');

      expect(result.archivedCount).toBe(1);
      expect(result.destination).toBe('s3://archive/');

      // Verify old entry is archived
      const remaining = repository.getAllEntries();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.entityId).toBe('student-new');

      // Verify archived entries
      const archived = repository.getArchivedEntries();
      expect(archived).toHaveLength(1);
      expect(archived[0]!.entityId).toBe('student-old');
    });

    it('should return archival candidate count', async () => {
      await service.setRetentionConfig({
        tenantId: 'tenant-1',
        retentionMonths: 1,
        archivalEnabled: true,
        archivalDestination: 's3://archive/',
      });

      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 3);

      await repository.create({
        id: 'old-1',
        tenantId: 'tenant-1',
        entityType: 'student',
        entityId: 'student-1',
        operation: 'CREATE',
        userId: 'user-1',
        userName: 'Admin',
        ipAddress: '192.168.1.1',
        timestamp: oldDate,
        beforeValues: null,
        afterValues: { name: 'Old' },
        metadata: null,
      });

      const count = await service.getArchivalCandidateCount('tenant-1');
      expect(count).toBe(1);
    });
  });
});
