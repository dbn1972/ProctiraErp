/**
 * Unit tests for parallel operation management.
 * Tests routing logic, phase transitions, and health monitoring.
 */

import { describe, it, expect } from 'vitest';
import {
  ParallelOperationManager,
  DEFAULT_ROUTING,
  RoutingConfig,
  runParallelOperationCheck,
} from './parallel-operation.js';
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

        manager.advancePhase({ bothHealthy: true, drift: 0 });
        expect(manager.getPhase()).toBe('cutover');

        manager.advancePhase({ bothHealthy: true, drift: 0 });
        expect(manager.getPhase()).toBe('legacy_decommission');
      });

      it('should not advance past legacy_decommission', () => {
        const manager = new ParallelOperationManager(mockConfig);

        // Advance to the end
        manager.advancePhase(); // dual_write
        manager.advancePhase(); // shadow_read
        manager.advancePhase({ bothHealthy: true, drift: 0 }); // cutover
        manager.advancePhase({ bothHealthy: true, drift: 0 }); // legacy_decommission
        manager.advancePhase({ bothHealthy: true, drift: 0 }); // should stay at legacy_decommission

        expect(manager.getPhase()).toBe('legacy_decommission');
      });

      it('PRC-L507: refuses cutover without a health+drift guard', () => {
        const manager = new ParallelOperationManager(mockConfig);
        manager.advancePhase(); // dual_write
        manager.advancePhase(); // shadow_read
        // No guard → must throw rather than silently cutting over.
        expect(() => manager.advancePhase()).toThrow(/requires a health\+drift guard|PRC-L507/);
        expect(manager.getPhase()).toBe('shadow_read');
      });

      it('PRC-L507: refuses cutover when systems unhealthy or drift != 0', () => {
        const manager = new ParallelOperationManager(mockConfig);
        manager.advancePhase();
        manager.advancePhase();
        expect(() => manager.advancePhase({ bothHealthy: false, drift: 0 })).toThrow(/healthy/);
        expect(() => manager.advancePhase({ bothHealthy: true, drift: 5 })).toThrow(/drift/);
        expect(manager.getPhase()).toBe('shadow_read');
        // Clean state advances.
        expect(manager.advancePhase({ bothHealthy: true, drift: 0 })).toBe('cutover');
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
        manager.advancePhase({ bothHealthy: true, drift: 0 }); // cutover

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

/**
 * PRC-M423 — "legacy MySQL health" used to run SELECT 1 on the same Postgres pool as the
 * new system. The probe now runs on its own mysql2 pool built from config.mysql.
 */
describe('PRC-M423 legacy health probes MySQL, not the Postgres pool', () => {
  it('checkLegacyHealth queries the legacy pool and reports its outcome', async () => {
    const queries: string[] = [];
    const legacy = {
      query: async (sql: string) => {
        queries.push(sql);
        return [[{ 1: 1 }], []];
      },
      end: async () => undefined,
    };
    const manager = new ParallelOperationManager(mockConfig);
    const health = await manager.checkLegacyHealth(legacy);
    expect(queries).toEqual(['SELECT 1']);
    expect(health).toMatchObject({ system: 'legacy_mysql', status: 'healthy', errorRate: 0 });

    const down = await manager.checkLegacyHealth({
      query: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:3306');
      },
      end: async () => undefined,
    });
    expect(down.status).toBe('unavailable');
  });

  it('runParallelOperationCheck opens the legacy pool from config.mysql', async () => {
    const opened: unknown[] = [];
    let ended = false;
    const result = await runParallelOperationCheck(
      { ...mockConfig, pg: { ...mockConfig.pg, host: '127.0.0.1', port: 1 } },
      {
        createLegacyPool: (mysql) => {
          opened.push(mysql);
          return {
            query: async () => {
              throw new Error('legacy down');
            },
            end: async () => {
              ended = true;
            },
          };
        },
      },
    );
    expect(opened).toEqual([mockConfig.mysql]);
    expect(ended).toBe(true);
    // Postgres on port 1 is unreachable too; the legacy outcome is reported on its own.
    expect(JSON.stringify(result.warnings)).toContain('Legacy system is unavailable');
  });
});
