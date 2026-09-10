/**
 * Unit tests for parallel operation management.
 * Tests routing logic, phase transitions, and health monitoring.
 */

import { describe, it, expect } from 'vitest';
import { ParallelOperationManager, DEFAULT_ROUTING, RoutingConfig } from './parallel-operation.js';
import { MigrationConfig } from './types.js';

const mockConfig: MigrationConfig = {
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

describe('parallel-operation', () => {
  describe('ParallelOperationManager', () => {
    describe('initialization', () => {
      it('should start in initial_sync phase', () => {
        const manager = new ParallelOperationManager(mockConfig);
        expect(manager.getPhase()).toBe('initial_sync');
      });

      it('should use default routing when none provided', () => {
        const manager = new ParallelOperationManager(mockConfig);
        const routing = manager.getRouting();
        expect(routing.readTrafficPercent).toBe(0);
        expect(routing.writeTrafficPercent).toBe(0);
        expect(routing.fullyMigratedTables).toEqual([]);
      });

      it('should accept custom routing configuration', () => {
        const customRouting: RoutingConfig = {
          readTrafficPercent: 50,
          writeTrafficPercent: 100,
          fullyMigratedTables: ['institutions'],
          dualWriteTables: ['students'],
          legacyOnlyTables: ['staff'],
        };
        const manager = new ParallelOperationManager(mockConfig, customRouting);
        const routing = manager.getRouting();
        expect(routing.readTrafficPercent).toBe(50);
        expect(routing.writeTrafficPercent).toBe(100);
        expect(routing.fullyMigratedTables).toContain('institutions');
      });
    });

    describe('phase transitions', () => {
      it('should advance through phases in order', () => {
        const manager = new ParallelOperationManager(mockConfig);

        expect(manager.getPhase()).toBe('initial_sync');

        manager.advancePhase();
        expect(manager.getPhase()).toBe('dual_write');

        manager.advancePhase();
        expect(manager.getPhase()).toBe('shadow_read');

        manager.advancePhase();
        expect(manager.getPhase()).toBe('cutover');

        manager.advancePhase();
        expect(manager.getPhase()).toBe('legacy_decommission');
      });

      it('should not advance past legacy_decommission', () => {
        const manager = new ParallelOperationManager(mockConfig);

        // Advance to the end
        manager.advancePhase(); // dual_write
        manager.advancePhase(); // shadow_read
        manager.advancePhase(); // cutover
        manager.advancePhase(); // legacy_decommission
        manager.advancePhase(); // should stay at legacy_decommission

        expect(manager.getPhase()).toBe('legacy_decommission');
      });

      it('should rollback to previous phase', () => {
        const manager = new ParallelOperationManager(mockConfig);

        manager.advancePhase(); // dual_write
        manager.advancePhase(); // shadow_read

        manager.rollbackPhase();
        expect(manager.getPhase()).toBe('dual_write');

        manager.rollbackPhase();
        expect(manager.getPhase()).toBe('initial_sync');
      });

      it('should not rollback past initial_sync', () => {
        const manager = new ParallelOperationManager(mockConfig);
        manager.rollbackPhase();
        expect(manager.getPhase()).toBe('initial_sync');
      });

      it('should update routing on dual_write phase', () => {
        const manager = new ParallelOperationManager(mockConfig);
        manager.advancePhase(); // dual_write

        const routing = manager.getRouting();
        expect(routing.writeTrafficPercent).toBe(100);
        expect(routing.dualWriteTables.length).toBeGreaterThan(0);
        expect(routing.legacyOnlyTables).toEqual([]);
      });

      it('should update routing on shadow_read phase', () => {
        const manager = new ParallelOperationManager(mockConfig);
        manager.advancePhase(); // dual_write
        manager.advancePhase(); // shadow_read

        const routing = manager.getRouting();
        expect(routing.readTrafficPercent).toBe(50);
      });

      it('should update routing on cutover phase', () => {
        const manager = new ParallelOperationManager(mockConfig);
        manager.advancePhase(); // dual_write
        manager.advancePhase(); // shadow_read
        manager.advancePhase(); // cutover

        const routing = manager.getRouting();
        expect(routing.readTrafficPercent).toBe(100);
        expect(routing.writeTrafficPercent).toBe(100);
        expect(routing.fullyMigratedTables.length).toBeGreaterThan(0);
        expect(routing.dualWriteTables).toEqual([]);
      });
    });

    describe('traffic routing', () => {
      it('should route reads to legacy for legacy-only tables', () => {
        const manager = new ParallelOperationManager(mockConfig, {
          readTrafficPercent: 100,
          writeTrafficPercent: 0,
          fullyMigratedTables: [],
          dualWriteTables: [],
          legacyOnlyTables: ['old_table'],
        });

        expect(manager.routeRead('old_table')).toBe('legacy');
      });

      it('should route reads to new for fully migrated tables', () => {
        const manager = new ParallelOperationManager(mockConfig, {
          readTrafficPercent: 0,
          writeTrafficPercent: 0,
          fullyMigratedTables: ['institutions'],
          dualWriteTables: [],
          legacyOnlyTables: [],
        });

        expect(manager.routeRead('institutions')).toBe('new');
      });

      it('should route writes to legacy only for legacy-only tables', () => {
        const manager = new ParallelOperationManager(mockConfig, {
          readTrafficPercent: 0,
          writeTrafficPercent: 100,
          fullyMigratedTables: [],
          dualWriteTables: [],
          legacyOnlyTables: ['old_table'],
        });

        expect(manager.routeWrite('old_table')).toEqual(['legacy']);
      });

      it('should route writes to new only for fully migrated tables', () => {
        const manager = new ParallelOperationManager(mockConfig, {
          readTrafficPercent: 0,
          writeTrafficPercent: 100,
          fullyMigratedTables: ['institutions'],
          dualWriteTables: [],
          legacyOnlyTables: [],
        });

        expect(manager.routeWrite('institutions')).toEqual(['new']);
      });

      it('should dual-write for tables in dual-write mode', () => {
        const manager = new ParallelOperationManager(mockConfig, {
          readTrafficPercent: 50,
          writeTrafficPercent: 100,
          fullyMigratedTables: [],
          dualWriteTables: ['students'],
          legacyOnlyTables: [],
        });

        expect(manager.routeWrite('students')).toEqual(['legacy', 'new']);
      });
    });

    describe('setReadTrafficPercent', () => {
      it('should update read traffic percentage', () => {
        const manager = new ParallelOperationManager(mockConfig);
        manager.setReadTrafficPercent(75);
        expect(manager.getRouting().readTrafficPercent).toBe(75);
      });

      it('should reject values below 0', () => {
        const manager = new ParallelOperationManager(mockConfig);
        expect(() => manager.setReadTrafficPercent(-1)).toThrow();
      });

      it('should reject values above 100', () => {
        const manager = new ParallelOperationManager(mockConfig);
        expect(() => manager.setReadTrafficPercent(101)).toThrow();
      });

      it('should accept boundary values 0 and 100', () => {
        const manager = new ParallelOperationManager(mockConfig);
        manager.setReadTrafficPercent(0);
        expect(manager.getRouting().readTrafficPercent).toBe(0);
        manager.setReadTrafficPercent(100);
        expect(manager.getRouting().readTrafficPercent).toBe(100);
      });
    });

    describe('getStatus', () => {
      it('should return complete status object', () => {
        const manager = new ParallelOperationManager(mockConfig);
        const status = manager.getStatus();

        expect(status.phase).toBe('initial_sync');
        expect(status.routing).toBeDefined();
        expect(status.health).toBeDefined();
        expect(status.consistency).toBeDefined();
        expect(status.startedAt).toBeDefined();
        expect(status.lastUpdatedAt).toBeDefined();
      });

      it('should reflect current phase in status', () => {
        const manager = new ParallelOperationManager(mockConfig);
        manager.advancePhase();
        manager.advancePhase();

        const status = manager.getStatus();
        expect(status.phase).toBe('shadow_read');
      });
    });
  });

  describe('DEFAULT_ROUTING', () => {
    it('should start with zero traffic to new system', () => {
      expect(DEFAULT_ROUTING.readTrafficPercent).toBe(0);
      expect(DEFAULT_ROUTING.writeTrafficPercent).toBe(0);
    });

    it('should have no fully migrated tables initially', () => {
      expect(DEFAULT_ROUTING.fullyMigratedTables).toEqual([]);
    });

    it('should have no dual-write tables initially', () => {
      expect(DEFAULT_ROUTING.dualWriteTables).toEqual([]);
    });

    it('should list all source tables as legacy-only initially', () => {
      expect(DEFAULT_ROUTING.legacyOnlyTables.length).toBeGreaterThan(0);
    });
  });
});
