/**
 * Bootstrap Store - Persistence layer for bootstrap run records.
 *
 * Records configuration state in the install_bootstrap_runs table.
 * Uses an in-memory fallback when the database is not yet configured
 * (since database is one of the steps being configured).
 */

import type { BootstrapRunRecord, BootstrapStep } from './types';

/**
 * Interface for persisting bootstrap run records.
 * Implementations can use database or in-memory storage.
 */
export interface BootstrapStore {
  /** Create a new bootstrap run record */
  createRun(run: BootstrapRunRecord): Promise<void>;
  /** Update an existing bootstrap run record */
  updateRun(id: string, updates: Partial<BootstrapRunRecord>): Promise<void>;
  /** Get the latest bootstrap run */
  getLatestRun(): Promise<BootstrapRunRecord | null>;
  /** Get a specific run by ID */
  getRun(id: string): Promise<BootstrapRunRecord | null>;
}

/**
 * In-memory implementation of BootstrapStore.
 * Used during the bootstrap process before the database is configured,
 * and for testing purposes.
 */
export class InMemoryBootstrapStore implements BootstrapStore {
  private runs: Map<string, BootstrapRunRecord> = new Map();

  async createRun(run: BootstrapRunRecord): Promise<void> {
    this.runs.set(run.id, { ...run });
  }

  async updateRun(id: string, updates: Partial<BootstrapRunRecord>): Promise<void> {
    const existing = this.runs.get(id);
    if (!existing) {
      throw new Error(`Bootstrap run not found: ${id}`);
    }
    this.runs.set(id, { ...existing, ...updates });
  }

  async getLatestRun(): Promise<BootstrapRunRecord | null> {
    let latest: BootstrapRunRecord | null = null;
    for (const run of this.runs.values()) {
      if (!latest || run.startedAt > latest.startedAt) {
        latest = run;
      }
    }
    return latest;
  }

  async getRun(id: string): Promise<BootstrapRunRecord | null> {
    return this.runs.get(id) ?? null;
  }

  /** Get all runs (for testing) */
  getAllRuns(): BootstrapRunRecord[] {
    return Array.from(this.runs.values());
  }

  /** Clear all runs (for testing) */
  clear(): void {
    this.runs.clear();
  }
}

/**
 * Database-backed implementation of BootstrapStore.
 * Stores records in the install_bootstrap_runs table.
 *
 * Note: This is used after the database step is configured.
 * Before that, InMemoryBootstrapStore is used.
 */
export class DatabaseBootstrapStore implements BootstrapStore {
  constructor(private readonly query: <T>(sql: string, params?: unknown[]) => Promise<T[]>) {}

  async createRun(run: BootstrapRunRecord): Promise<void> {
    await this.query(
      `INSERT INTO install_bootstrap_runs (id, status, completed_steps, adapter_configs, started_at, completed_at, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        run.id,
        run.status,
        JSON.stringify(run.completedSteps),
        JSON.stringify(run.adapterConfigs),
        run.startedAt,
        run.completedAt ?? null,
        run.error ?? null,
      ],
    );
  }

  async updateRun(id: string, updates: Partial<BootstrapRunRecord>): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(updates.status);
    }
    if (updates.completedSteps !== undefined) {
      setClauses.push(`completed_steps = $${paramIndex++}`);
      params.push(JSON.stringify(updates.completedSteps));
    }
    if (updates.adapterConfigs !== undefined) {
      setClauses.push(`adapter_configs = $${paramIndex++}`);
      params.push(JSON.stringify(updates.adapterConfigs));
    }
    if (updates.completedAt !== undefined) {
      setClauses.push(`completed_at = $${paramIndex++}`);
      params.push(updates.completedAt);
    }
    if (updates.error !== undefined) {
      setClauses.push(`error = $${paramIndex++}`);
      params.push(updates.error);
    }

    if (setClauses.length === 0) return;

    params.push(id);
    await this.query(
      `UPDATE install_bootstrap_runs SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      params,
    );
  }

  async getLatestRun(): Promise<BootstrapRunRecord | null> {
    const rows = await this.query<{
      id: string;
      status: string;
      completed_steps: string;
      adapter_configs: string;
      started_at: string;
      completed_at: string | null;
      error: string | null;
    }>(
      `SELECT id, status, completed_steps, adapter_configs, started_at, completed_at, error
       FROM install_bootstrap_runs
       ORDER BY started_at DESC
       LIMIT 1`,
    );

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      id: row.id,
      status: row.status as BootstrapRunRecord['status'],
      completedSteps: JSON.parse(row.completed_steps) as BootstrapStep[],
      adapterConfigs: JSON.parse(row.adapter_configs) as Record<BootstrapStep, unknown>,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      error: row.error ?? undefined,
    };
  }

  async getRun(id: string): Promise<BootstrapRunRecord | null> {
    const rows = await this.query<{
      id: string;
      status: string;
      completed_steps: string;
      adapter_configs: string;
      started_at: string;
      completed_at: string | null;
      error: string | null;
    }>(
      `SELECT id, status, completed_steps, adapter_configs, started_at, completed_at, error
       FROM install_bootstrap_runs
       WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      id: row.id,
      status: row.status as BootstrapRunRecord['status'],
      completedSteps: JSON.parse(row.completed_steps) as BootstrapStep[],
      adapterConfigs: JSON.parse(row.adapter_configs) as Record<BootstrapStep, unknown>,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      error: row.error ?? undefined,
    };
  }
}
