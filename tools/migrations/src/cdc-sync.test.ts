/**
 * Unit tests for CDC incremental sync.
 * Tests event creation, serialization, topic naming, and consumer logic.
 */

import { describe, it, expect } from 'vitest';
import {
  CDCEvent,
  CDCProducer,
  CDCConsumer,
  CDCSyncConfig,
  buildCDCTopic,
  serializeCDCEvent,
  deserializeCDCEvent,
  DEFAULT_CDC_CONFIG,
} from './cdc-sync.js';
import { MigrationConfig } from './types.js';

const mockMigrationConfig: MigrationConfig = {
  mysql: {
    host: 'localhost',
    port: 3306,
    database: 'proctira_core',
    user: 'root',
    password: '',
  },
  pg: {
    host: 'localhost',
    port: 5432,
    database: 'proctira_unified',
    user: 'postgres',
    password: '',
    schema: 'public',
  },
  batchSize: 5000,
  defaultTenantName: 'Test Org',
  defaultTenantSlug: 'test',
  stagingSchema: 'migration_staging',
  logLevel: 'info',
  pgloaderBin: 'pgloader',
};

const mockCDCConfig: CDCSyncConfig = {
  kafkaBrokers: ['localhost:9092'],
  kafkaClientId: 'test-cdc-producer',
  consumerGroupId: 'test-cdc-consumers',
  topicPrefix: 'cdc.test',
  pollIntervalMs: 1000,
  batchSize: 100,
  tenantId: 'tenant-123',
  conflictResolution: 'source_wins',
};

describe('cdc-sync', () => {
  describe('buildCDCTopic', () => {
    it('should build topic name with prefix, tenant, and table', () => {
      const topic = buildCDCTopic('cdc.migration', 'tenant-abc', 'institutions');
      expect(topic).toBe('cdc.migration.tenant-abc.institutions');
    });

    it('should handle different prefixes', () => {
      const topic = buildCDCTopic('prod.cdc', 'org-1', 'students');
      expect(topic).toBe('prod.cdc.org-1.students');
    });

    it('should handle special characters in tenant ID', () => {
      const topic = buildCDCTopic('cdc', 'tenant_with-special.chars', 'staff');
      expect(topic).toBe('cdc.tenant_with-special.chars.staff');
    });
  });

  describe('serializeCDCEvent / deserializeCDCEvent', () => {
    it('should serialize and deserialize a CDC event', () => {
      const event: CDCEvent = {
        id: 'cdc_institutions_42_1',
        tenantId: 'tenant-123',
        operation: 'UPDATE',
        sourceTable: 'institutions',
        targetTable: 'institutions',
        legacyId: 42,
        newId: 'uuid-abc-123',
        data: { name: 'Test School', code: 'TST001', status: 'active' },
        previousData: { name: 'Old Name' },
        sourceTimestamp: '2024-01-15T10:00:00.000Z',
        capturedAt: '2024-01-15T10:00:01.000Z',
        sequence: 1,
      };

      const serialized = serializeCDCEvent(event);
      const deserialized = deserializeCDCEvent(serialized);

      expect(deserialized.id).toBe(event.id);
      expect(deserialized.tenantId).toBe(event.tenantId);
      expect(deserialized.operation).toBe('UPDATE');
      expect(deserialized.sourceTable).toBe('institutions');
      expect(deserialized.targetTable).toBe('institutions');
      expect(deserialized.legacyId).toBe(42);
      expect(deserialized.newId).toBe('uuid-abc-123');
      expect(deserialized.data).toEqual({ name: 'Test School', code: 'TST001', status: 'active' });
      expect(deserialized.previousData).toEqual({ name: 'Old Name' });
      expect(deserialized.sequence).toBe(1);
    });

    it('should handle INSERT events without previousData', () => {
      const event: CDCEvent = {
        id: 'cdc_students_100_5',
        tenantId: 'tenant-456',
        operation: 'INSERT',
        sourceTable: 'security_users',
        targetTable: 'students',
        legacyId: 100,
        data: { first_name: 'John', last_name: 'Doe', date_of_birth: '2010-05-15' },
        sourceTimestamp: '2024-01-15T11:00:00.000Z',
        capturedAt: '2024-01-15T11:00:00.500Z',
        sequence: 5,
      };

      const serialized = serializeCDCEvent(event);
      const deserialized = deserializeCDCEvent(serialized);

      expect(deserialized.operation).toBe('INSERT');
      expect(deserialized.previousData).toBeUndefined();
      expect(deserialized.newId).toBeUndefined();
    });

    it('should handle DELETE events', () => {
      const event: CDCEvent = {
        id: 'cdc_staff_77_10',
        tenantId: 'tenant-789',
        operation: 'DELETE',
        sourceTable: 'security_users',
        targetTable: 'staff',
        legacyId: 77,
        newId: 'uuid-del-789',
        data: { first_name: 'Jane', last_name: 'Smith' },
        sourceTimestamp: '2024-01-15T12:00:00.000Z',
        capturedAt: '2024-01-15T12:00:00.100Z',
        sequence: 10,
      };

      const serialized = serializeCDCEvent(event);
      const deserialized = deserializeCDCEvent(serialized);

      expect(deserialized.operation).toBe('DELETE');
      expect(deserialized.newId).toBe('uuid-del-789');
    });
  });

  describe('CDCProducer', () => {
    it('should build topic names correctly', () => {
      const producer = new CDCProducer(mockCDCConfig, mockMigrationConfig);
      const topic = producer.buildTopicName('institutions');
      expect(topic).toBe('cdc.test.tenant-123.institutions');
    });

    it('should start in non-running state', () => {
      const producer = new CDCProducer(mockCDCConfig, mockMigrationConfig);
      expect(producer.isRunning()).toBe(false);
    });

    it('should track running state', () => {
      const producer = new CDCProducer(mockCDCConfig, mockMigrationConfig);
      producer.start();
      expect(producer.isRunning()).toBe(true);
      producer.stop();
      expect(producer.isRunning()).toBe(false);
    });

    it('should return empty sync positions before initialization', () => {
      const producer = new CDCProducer(mockCDCConfig, mockMigrationConfig);
      expect(producer.getSyncPositions()).toEqual([]);
    });
  });

  describe('CDCConsumer', () => {
    it('should start in non-running state', () => {
      const consumer = new CDCConsumer(mockCDCConfig, mockMigrationConfig);
      expect(consumer.isRunning()).toBe(false);
    });

    it('should track running state', () => {
      const consumer = new CDCConsumer(mockCDCConfig, mockMigrationConfig);
      consumer.start();
      expect(consumer.isRunning()).toBe(true);
      consumer.stop();
      expect(consumer.isRunning()).toBe(false);
    });

    it('should start with zero processing stats', () => {
      const consumer = new CDCConsumer(mockCDCConfig, mockMigrationConfig);
      const stats = consumer.getStats();
      expect(stats.processedCount).toBe(0);
      expect(stats.errorCount).toBe(0);
    });
  });

  describe('DEFAULT_CDC_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_CDC_CONFIG.topicPrefix).toBe('cdc.migration');
      expect(DEFAULT_CDC_CONFIG.pollIntervalMs).toBe(5000);
      expect(DEFAULT_CDC_CONFIG.batchSize).toBe(1000);
      expect(DEFAULT_CDC_CONFIG.conflictResolution).toBe('source_wins');
    });
  });

  describe('CDCEvent structure', () => {
    it('should support all operation types', () => {
      const operations: CDCEvent['operation'][] = ['INSERT', 'UPDATE', 'DELETE'];
      for (const op of operations) {
        const event: CDCEvent = {
          id: `test_${op}`,
          tenantId: 'tenant-1',
          operation: op,
          sourceTable: 'test',
          targetTable: 'test',
          legacyId: 1,
          data: {},
          sourceTimestamp: new Date().toISOString(),
          capturedAt: new Date().toISOString(),
          sequence: 1,
        };
        expect(event.operation).toBe(op);
      }
    });
  });
});
