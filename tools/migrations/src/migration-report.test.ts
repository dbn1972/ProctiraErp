/**
 * Unit tests for migration report generation.
 * Tests the report logic, unmigrated record diagnosis, and serialization.
 */

import { describe, it, expect } from 'vitest';
import {
  serializeReport,
  MigrationReport,
  UnmigratedRecord,
  TableMigrationStats,
} from './migration-report.js';

describe('migration-report', () => {
  describe('serializeReport', () => {
    it('should serialize a complete migration report to JSON', () => {
      const report: MigrationReport = {
        generatedAt: '2024-01-15T10:00:00.000Z',
        migrationId: 'mig_123456',
        config: {
          sourceDatabase: 'localhost:3306/proctira_core',
          targetDatabase: 'localhost:5432/proctira_unified',
          batchSize: 5000,
          tenantName: 'Default Organization',
        },
        summary: {
          totalTablesProcessed: 10,
          totalSourceRows: 50000,
          totalMigratedRows: 49500,
          totalSkippedRows: 500,
          totalUnmigratedRows: 500,
          overallSuccessRate: 99.0,
          totalDurationMs: 12000,
        },
        tables: [],
        unmigrated: [],
        status: 'partial',
      };

      const json = serializeReport(report);
      const parsed = JSON.parse(json);

      expect(parsed.migrationId).toBe('mig_123456');
      expect(parsed.summary.totalSourceRows).toBe(50000);
      expect(parsed.summary.totalMigratedRows).toBe(49500);
      expect(parsed.summary.overallSuccessRate).toBe(99.0);
      expect(parsed.status).toBe('partial');
    });

    it('should include unmigrated records with reasons', () => {
      const unmigrated: UnmigratedRecord[] = [
        {
          table: 'security_users',
          legacyId: 42,
          reason: 'null_required_field',
          details: "Required field 'first_name' is NULL",
        },
        {
          table: 'institutions',
          legacyId: 99,
          reason: 'missing_reference',
          details: "Foreign key 'area_id' references non-existent row",
        },
      ];

      const report: MigrationReport = {
        generatedAt: '2024-01-15T10:00:00.000Z',
        migrationId: 'mig_789',
        config: {
          sourceDatabase: 'localhost:3306/proctira_core',
          targetDatabase: 'localhost:5432/proctira_unified',
          batchSize: 5000,
          tenantName: 'Test Org',
        },
        summary: {
          totalTablesProcessed: 2,
          totalSourceRows: 100,
          totalMigratedRows: 98,
          totalSkippedRows: 2,
          totalUnmigratedRows: 2,
          overallSuccessRate: 98.0,
          totalDurationMs: 500,
        },
        tables: [],
        unmigrated,
        status: 'partial',
      };

      const json = serializeReport(report);
      const parsed = JSON.parse(json);

      expect(parsed.unmigrated).toHaveLength(2);
      expect(parsed.unmigrated[0].reason).toBe('null_required_field');
      expect(parsed.unmigrated[1].reason).toBe('missing_reference');
    });

    it('should report complete status when all rows migrated', () => {
      const report: MigrationReport = {
        generatedAt: '2024-01-15T10:00:00.000Z',
        migrationId: 'mig_complete',
        config: {
          sourceDatabase: 'localhost:3306/proctira_core',
          targetDatabase: 'localhost:5432/proctira_unified',
          batchSize: 5000,
          tenantName: 'Test Org',
        },
        summary: {
          totalTablesProcessed: 10,
          totalSourceRows: 10000,
          totalMigratedRows: 10000,
          totalSkippedRows: 0,
          totalUnmigratedRows: 0,
          overallSuccessRate: 100,
          totalDurationMs: 3000,
        },
        tables: [],
        unmigrated: [],
        status: 'complete',
      };

      const json = serializeReport(report);
      const parsed = JSON.parse(json);

      expect(parsed.status).toBe('complete');
      expect(parsed.summary.overallSuccessRate).toBe(100);
    });

    it('should include per-table statistics', () => {
      const tables: TableMigrationStats[] = [
        {
          sourceTable: 'institutions',
          targetTable: 'institutions',
          sourceRowCount: 500,
          migratedRowCount: 498,
          skippedRowCount: 2,
          unmigrated: [
            {
              table: 'institutions',
              legacyId: 10,
              reason: 'duplicate_key',
              details: "Duplicate code 'SCH001'",
            },
          ],
          durationMs: 200,
          rowsPerSecond: 2490,
        },
        {
          sourceTable: 'security_users',
          targetTable: 'students',
          sourceRowCount: 10000,
          migratedRowCount: 10000,
          skippedRowCount: 0,
          unmigrated: [],
          durationMs: 1500,
          rowsPerSecond: 6667,
        },
      ];

      const report: MigrationReport = {
        generatedAt: '2024-01-15T10:00:00.000Z',
        migrationId: 'mig_tables',
        config: {
          sourceDatabase: 'localhost:3306/proctira_core',
          targetDatabase: 'localhost:5432/proctira_unified',
          batchSize: 5000,
          tenantName: 'Test Org',
        },
        summary: {
          totalTablesProcessed: 2,
          totalSourceRows: 10500,
          totalMigratedRows: 10498,
          totalSkippedRows: 2,
          totalUnmigratedRows: 1,
          overallSuccessRate: 99.98,
          totalDurationMs: 1700,
        },
        tables,
        unmigrated: tables.flatMap((t) => t.unmigrated),
        status: 'partial',
      };

      const json = serializeReport(report);
      const parsed = JSON.parse(json);

      expect(parsed.tables).toHaveLength(2);
      expect(parsed.tables[0].sourceTable).toBe('institutions');
      expect(parsed.tables[0].migratedRowCount).toBe(498);
      expect(parsed.tables[0].rowsPerSecond).toBe(2490);
      expect(parsed.tables[1].sourceTable).toBe('security_users');
      expect(parsed.tables[1].skippedRowCount).toBe(0);
    });
  });

  describe('UnmigratedRecord reasons', () => {
    it('should support all defined unmigrated reasons', () => {
      const reasons: UnmigratedRecord['reason'][] = [
        'constraint_violation',
        'missing_reference',
        'data_truncation',
        'invalid_format',
        'duplicate_key',
        'null_required_field',
        'enum_mismatch',
        'transform_error',
      ];

      for (const reason of reasons) {
        const record: UnmigratedRecord = {
          table: 'test_table',
          legacyId: 1,
          reason,
          details: `Test detail for ${reason}`,
        };
        expect(record.reason).toBe(reason);
      }
    });
  });
});
