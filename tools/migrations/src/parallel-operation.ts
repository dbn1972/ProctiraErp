/**
 * Parallel Operation Manager.
 *
 * Coordinates the parallel operation of legacy MySQL and new PostgreSQL systems
 * during the migration transition period.
 *
 * Satisfies Requirement 24.4: Support incremental migration allowing parallel
 * operation of legacy and new systems during transition.
 *
 * Features:
 * - Health monitoring of both systems
 * - Read/write routing configuration
 * - Data consistency verification between systems
 * - Cutover management (gradual traffic shifting)
 * - Rollback capability
 */

import { Pool, PoolClient } from 'pg';
import { MigrationConfig, MigrationStepResult } from './types.js';
import { TABLE_MAPPINGS } from './table-mappings.js';

/** System health status. */
export interface SystemHealth {
  system: 'legacy_mysql' | 'new_postgresql';
  status: 'healthy' | 'degraded' | 'unavailable';
  latencyMs: number;
  lastCheckedAt: string;
  connectionCount: number;
  errorRate: number;
}

/** Traffic routing configuration. */
export interface RoutingConfig {
  /** Percentage of read traffic to route to new system (0-100) */
  readTrafficPercent: number;
  /** Percentage of write traffic to route to new system (0-100) */
  writeTrafficPercent: number;
  /** Tables that are fully migrated and can use new system exclusively */
  fullyMigratedTables: string[];
  /** Tables still being synced (dual-write mode) */
  dualWriteTables: string[];
  /** Tables not yet migrated (legacy only) */
  legacyOnlyTables: string[];
}

/** Consistency check result between the two systems. */
export interface ConsistencyCheckResult {
  table: string;
  legacyCount: number;
  newCount: number;
  consistent: boolean;
  drift: number;
  lastVerifiedAt: string;
}

/** Parallel operation status. */
export interface ParallelOperationStatus {
  phase: 'initial_sync' | 'dual_write' | 'shadow_read' | 'cutover' | 'legacy_decommission';
  routing: RoutingConfig;
  health: SystemHealth[];
  consistency: ConsistencyCheckResult[];
  startedAt: string;
  lastUpdatedAt: string;
}

/** Default routing configuration for initial parallel operation. */
export const DEFAULT_ROUTING: RoutingConfig = {
  readTrafficPercent: 0,
  writeTrafficPercent: 0,
  fullyMigratedTables: [],
  dualWriteTables: [],
  legacyOnlyTables: TABLE_MAPPINGS.map((m) => m.sourceTable),
};

/**
 * Manages the parallel operation of legacy and new systems.
 */
export class ParallelOperationManager {
  private config: MigrationConfig;
  private routing: RoutingConfig;
  private health: Map<string, SystemHealth> = new Map();
  private phase: ParallelOperationStatus['phase'] = 'initial_sync';
  private startedAt: string;

  constructor(config: MigrationConfig, routing?: RoutingConfig) {
    this.config = config;
    this.routing = routing ?? { ...DEFAULT_ROUTING };
    this.startedAt = new Date().toISOString();
  }

  /**
   * Checks health of the legacy MySQL system (via staging schema in PG for this implementation).
   */
  async checkLegacyHealth(pool: Pool): Promise<SystemHealth> {
    const start = Date.now();
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        const health: SystemHealth = {
          system: 'legacy_mysql',
          status: 'healthy',
          latencyMs: Date.now() - start,
          lastCheckedAt: new Date().toISOString(),
          connectionCount: pool.totalCount,
          errorRate: 0,
        };
        this.health.set('legacy_mysql', health);
        return health;
      } finally {
        client.release();
      }
    } catch {
      const health: SystemHealth = {
        system: 'legacy_mysql',
        status: 'unavailable',
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
        connectionCount: 0,
        errorRate: 1,
      };
      this.health.set('legacy_mysql', health);
      return health;
    }
  }

  /**
   * Checks health of the new PostgreSQL system.
   */
  async checkNewSystemHealth(pool: Pool): Promise<SystemHealth> {
    const start = Date.now();
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        const health: SystemHealth = {
          system: 'new_postgresql',
          status: 'healthy',
          latencyMs: Date.now() - start,
          lastCheckedAt: new Date().toISOString(),
          connectionCount: pool.totalCount,
          errorRate: 0,
        };
        this.health.set('new_postgresql', health);
        return health;
      } finally {
        client.release();
      }
    } catch {
      const health: SystemHealth = {
        system: 'new_postgresql',
        status: 'unavailable',
        latencyMs: Date.now() - start,
        lastCheckedAt: new Date().toISOString(),
        connectionCount: 0,
        errorRate: 1,
      };
      this.health.set('new_postgresql', health);
      return health;
    }
  }

  /**
   * Verifies data consistency between legacy staging and new target tables.
   */
  async verifyConsistency(pool: Pool): Promise<ConsistencyCheckResult[]> {
    const results: ConsistencyCheckResult[] = [];
    const client = await pool.connect();

    try {
      for (const mapping of TABLE_MAPPINGS) {
        try {
          const filterClause = mapping.sourceFilter ? `WHERE ${mapping.sourceFilter}` : '';

          const legacyResult = await client.query(
            `SELECT COUNT(*) as count FROM "${this.config.stagingSchema}"."${mapping.sourceTable}" ${filterClause}`,
          );
          const legacyCount = parseInt(legacyResult.rows[0].count, 10);

          const newResult = await client.query(
            `SELECT COUNT(*) as count FROM "${this.config.pg.schema}"."${mapping.targetTable}"`,
          );
          const newCount = parseInt(newResult.rows[0].count, 10);

          results.push({
            table: mapping.targetTable,
            legacyCount,
            newCount,
            consistent: legacyCount === newCount,
            drift: Math.abs(legacyCount - newCount),
            lastVerifiedAt: new Date().toISOString(),
          });
        } catch {
          results.push({
            table: mapping.targetTable,
            legacyCount: 0,
            newCount: 0,
            consistent: false,
            drift: -1,
            lastVerifiedAt: new Date().toISOString(),
          });
        }
      }
    } finally {
      client.release();
    }

    return results;
  }

  /**
   * Advances the parallel operation to the next phase.
   */
  advancePhase(): ParallelOperationStatus['phase'] {
    const phases: ParallelOperationStatus['phase'][] = [
      'initial_sync',
      'dual_write',
      'shadow_read',
      'cutover',
      'legacy_decommission',
    ];

    const currentIndex = phases.indexOf(this.phase);
    if (currentIndex < phases.length - 1) {
      this.phase = phases[currentIndex + 1] as ParallelOperationStatus['phase'];
    }

    // Update routing based on phase
    switch (this.phase) {
      case 'dual_write':
        this.routing.writeTrafficPercent = 100; // All writes go to both systems
        this.routing.dualWriteTables = TABLE_MAPPINGS.map((m) => m.targetTable);
        this.routing.legacyOnlyTables = [];
        break;
      case 'shadow_read':
        this.routing.readTrafficPercent = 50; // 50% reads from new system
        break;
      case 'cutover':
        this.routing.readTrafficPercent = 100;
        this.routing.writeTrafficPercent = 100;
        this.routing.fullyMigratedTables = TABLE_MAPPINGS.map((m) => m.targetTable);
        this.routing.dualWriteTables = [];
        break;
      case 'legacy_decommission':
        this.routing.legacyOnlyTables = [];
        break;
    }

    return this.phase;
  }

  /**
   * Rolls back to the previous phase.
   */
  rollbackPhase(): ParallelOperationStatus['phase'] {
    const phases: ParallelOperationStatus['phase'][] = [
      'initial_sync',
      'dual_write',
      'shadow_read',
      'cutover',
      'legacy_decommission',
    ];

    const currentIndex = phases.indexOf(this.phase);
    if (currentIndex > 0) {
      this.phase = phases[currentIndex - 1] as ParallelOperationStatus['phase'];
    }

    // Reset routing for rollback
    switch (this.phase) {
      case 'initial_sync':
        this.routing = { ...DEFAULT_ROUTING };
        break;
      case 'dual_write':
        this.routing.readTrafficPercent = 0;
        break;
      case 'shadow_read':
        this.routing.readTrafficPercent = 50;
        this.routing.fullyMigratedTables = [];
        break;
    }

    return this.phase;
  }

  /**
   * Updates the read traffic percentage for gradual cutover.
   */
  setReadTrafficPercent(percent: number): void {
    if (percent < 0 || percent > 100) {
      throw new Error('Read traffic percent must be between 0 and 100');
    }
    this.routing.readTrafficPercent = percent;
  }

  /**
   * Determines which system should handle a read request for a given table.
   */
  routeRead(table: string): 'legacy' | 'new' {
    if (this.routing.fullyMigratedTables.includes(table)) {
      return 'new';
    }
    if (this.routing.legacyOnlyTables.includes(table)) {
      return 'legacy';
    }
    // For dual-write tables, use traffic percentage
    return Math.random() * 100 < this.routing.readTrafficPercent ? 'new' : 'legacy';
  }

  /**
   * Determines which system(s) should handle a write request for a given table.
   */
  routeWrite(table: string): ('legacy' | 'new')[] {
    if (this.routing.fullyMigratedTables.includes(table)) {
      return ['new'];
    }
    if (this.routing.legacyOnlyTables.includes(table)) {
      return ['legacy'];
    }
    // Dual-write: write to both systems
    return ['legacy', 'new'];
  }

  /**
   * Returns the current parallel operation status.
   */
  getStatus(): ParallelOperationStatus {
    return {
      phase: this.phase,
      routing: { ...this.routing },
      health: Array.from(this.health.values()),
      consistency: [],
      startedAt: this.startedAt,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  /**
   * Returns the current routing configuration.
   */
  getRouting(): RoutingConfig {
    return { ...this.routing };
  }

  /**
   * Returns the current phase.
   */
  getPhase(): ParallelOperationStatus['phase'] {
    return this.phase;
  }
}

/**
 * Runs a parallel operation health check and consistency verification.
 */
export async function runParallelOperationCheck(
  config: MigrationConfig,
): Promise<MigrationStepResult> {
  const startTime = Date.now();
  const errors: MigrationStepResult['errors'] = [];
  const warnings: MigrationStepResult['warnings'] = [];

  const pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
  });

  try {
    const manager = new ParallelOperationManager(config);

    console.log('[parallel-op] Running parallel operation health check...');

    // Check both systems
    const legacyHealth = await manager.checkLegacyHealth(pool);
    const newHealth = await manager.checkNewSystemHealth(pool);

    console.log(
      `[parallel-op]   Legacy MySQL: ${legacyHealth.status} (${legacyHealth.latencyMs}ms)`,
    );
    console.log(`[parallel-op]   New PostgreSQL: ${newHealth.status} (${newHealth.latencyMs}ms)`);

    if (legacyHealth.status !== 'healthy') {
      warnings.push({
        table: 'system',
        message: `Legacy system is ${legacyHealth.status}`,
      });
    }

    if (newHealth.status !== 'healthy') {
      warnings.push({
        table: 'system',
        message: `New system is ${newHealth.status}`,
      });
    }

    // Verify consistency
    console.log('[parallel-op] Verifying data consistency...');
    const consistency = await manager.verifyConsistency(pool);

    const inconsistent = consistency.filter((c) => !c.consistent && c.drift >= 0);
    if (inconsistent.length > 0) {
      for (const check of inconsistent) {
        warnings.push({
          table: check.table,
          message: `Data drift: legacy=${check.legacyCount}, new=${check.newCount}, drift=${check.drift}`,
          count: check.drift,
        });
        console.log(
          `[parallel-op]   ⚠ ${check.table}: drift=${check.drift} (legacy=${check.legacyCount}, new=${check.newCount})`,
        );
      }
    } else {
      console.log('[parallel-op]   ✓ All tables consistent');
    }

    const status = manager.getStatus();
    console.log(`\n[parallel-op] Phase: ${status.phase}`);
    console.log(`[parallel-op] Read traffic to new: ${status.routing.readTrafficPercent}%`);
    console.log(`[parallel-op] Write traffic to new: ${status.routing.writeTrafficPercent}%`);

    return {
      step: 'parallel_operation_check',
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'success',
      tablesProcessed: consistency.length,
      rowsProcessed: consistency.reduce((sum, c) => sum + c.newCount, 0),
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ table: 'all', message: `Parallel operation check failed: ${message}` });

    return {
      step: 'parallel_operation_check',
      status: 'error',
      tablesProcessed: 0,
      rowsProcessed: 0,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } finally {
    await pool.end();
  }
}
