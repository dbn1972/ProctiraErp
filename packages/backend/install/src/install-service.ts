/**
 * Install Service - Core implementation.
 *
 * Manages the first-run configuration flow with step-by-step
 * adapter validation. Enforces all-or-nothing bootstrap semantics:
 * all adapters must be configured and validated before the system
 * is considered bootstrapped.
 *
 * Configuration flow: CDN → Database → Storage → Cache → Queue
 */

import { v4 as uuid } from 'uuid';
import type {
  InstallService,
  BootstrapStatus,
  BootstrapResult,
  ValidationResult,
  AggregatedHealth,
  AdapterHealth,
  AdapterStatus,
  BootstrapStep,
  BootstrapRunRecord,
  CdnConfigInput,
  DatabaseConfigInput,
  StorageConfigInput,
  CacheConfigInput,
  QueueConfigInput,
} from './types';
import { BOOTSTRAP_STEPS } from './types';
import type { BootstrapStore } from './bootstrap-store';
import {
  CdnValidator,
  DatabaseValidator,
  StorageValidator,
  CacheValidator,
  QueueValidator,
} from './adapter-validators';

/**
 * Minimal logger interface compatible with Pino.
 */
export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
}

/**
 * Dependencies injected into the InstallServiceImpl.
 */
export interface InstallServiceDependencies {
  /** Logger instance */
  logger: Logger;
  /** Store for persisting bootstrap run records */
  store: BootstrapStore;
  /** Optional connectivity tester override (for testing) */
  connectivityTester?: ConnectivityTester;
}

/**
 * Interface for testing actual connectivity to adapters.
 * Can be overridden in tests to avoid real network calls.
 */
export interface ConnectivityTester {
  testCdn?(config: CdnConfigInput): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
  testDatabase?(config: DatabaseConfigInput): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
  testStorage?(config: StorageConfigInput): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
  testCache?(config: CacheConfigInput): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
  testQueue?(config: QueueConfigInput): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
}

/**
 * Core implementation of the Install Service.
 *
 * Maintains in-memory state of the current bootstrap configuration
 * and persists completed runs to the store.
 */
export class InstallServiceImpl implements InstallService {
  private readonly logger: Logger;
  private readonly store: BootstrapStore;
  private readonly connectivityTester: ConnectivityTester;

  // Validators for each step
  private readonly cdnValidator = new CdnValidator();
  private readonly databaseValidator = new DatabaseValidator();
  private readonly storageValidator = new StorageValidator();
  private readonly cacheValidator = new CacheValidator();
  private readonly queueValidator = new QueueValidator();

  // Current bootstrap state (in-memory during configuration)
  private currentRunId: string | null = null;
  private completedSteps: Set<BootstrapStep> = new Set();
  private adapterConfigs: Partial<Record<BootstrapStep, unknown>> = {};
  private isBootstrapped = false;

  constructor(deps: InstallServiceDependencies) {
    this.logger = deps.logger;
    this.store = deps.store;
    this.connectivityTester = deps.connectivityTester ?? {};
  }

  /**
   * Returns the current bootstrap status.
   */
  async getBootstrapStatus(): Promise<BootstrapStatus> {
    // Check if there's a completed run in the store
    const latestRun = await this.store.getLatestRun();

    if (latestRun && latestRun.status === 'completed') {
      this.isBootstrapped = true;
      return {
        isComplete: true,
        completedSteps: [...BOOTSTRAP_STEPS],
        pendingSteps: [],
        adapterStatuses: Object.fromEntries(
          BOOTSTRAP_STEPS.map((step) => [step, 'configured' as AdapterStatus]),
        ) as Record<BootstrapStep, AdapterStatus>,
        lastRunAt: latestRun.completedAt,
        lastRunId: latestRun.id,
      };
    }

    // Build status from current in-memory state
    const completedSteps = Array.from(this.completedSteps);
    const pendingSteps = BOOTSTRAP_STEPS.filter((s) => !this.completedSteps.has(s));
    const adapterStatuses = Object.fromEntries(
      BOOTSTRAP_STEPS.map((step) => [
        step,
        this.completedSteps.has(step) ? 'configured' : 'pending',
      ]),
    ) as Record<BootstrapStep, AdapterStatus>;

    return {
      isComplete: false,
      completedSteps,
      pendingSteps,
      adapterStatuses,
      lastRunAt: latestRun?.startedAt,
      lastRunId: latestRun?.id,
    };
  }

  /**
   * Configure CDN adapter (Step 1).
   */
  async configureCDN(config: CdnConfigInput): Promise<ValidationResult> {
    this.logger.info({ adapter: config.adapter }, 'Configuring CDN adapter');

    // Ensure we have an active run
    await this.ensureActiveRun();

    // Validate configuration structure
    const result = await this.cdnValidator.validate(config);
    if (!result.success) {
      this.logger.warn({ error: result.error }, 'CDN validation failed');
      return result;
    }

    // Test connectivity if tester is available
    if (this.connectivityTester.testCdn) {
      const connectivity = await this.connectivityTester.testCdn(config);
      if (!connectivity.healthy) {
        return {
          success: false,
          step: 'cdn',
          message: 'CDN connectivity test failed',
          error: connectivity.error ?? 'Unable to reach CDN endpoint',
          latencyMs: connectivity.latencyMs,
        };
      }
      result.latencyMs = connectivity.latencyMs;
    }

    // Mark step as completed
    this.completedSteps.add('cdn');
    this.adapterConfigs['cdn'] = config;
    await this.persistStepCompletion('cdn');

    this.logger.info({ adapter: config.adapter, latencyMs: result.latencyMs }, 'CDN configured');
    return result;
  }

  /**
   * Configure Database adapter (Step 2).
   */
  async configureDatabase(config: DatabaseConfigInput): Promise<ValidationResult> {
    this.logger.info({ provider: config.provider, host: config.host }, 'Configuring database');

    await this.ensureActiveRun();

    // Enforce step ordering: CDN must be configured first
    const orderError = this.checkStepOrder('database');
    if (orderError) return orderError;

    const result = await this.databaseValidator.validate(config);
    if (!result.success) {
      this.logger.warn({ error: result.error }, 'Database validation failed');
      return result;
    }

    // Test connectivity
    if (this.connectivityTester.testDatabase) {
      const connectivity = await this.connectivityTester.testDatabase(config);
      if (!connectivity.healthy) {
        return {
          success: false,
          step: 'database',
          message: 'Database connectivity test failed',
          error: connectivity.error ?? 'Unable to connect to database',
          latencyMs: connectivity.latencyMs,
        };
      }
      result.latencyMs = connectivity.latencyMs;
    }

    this.completedSteps.add('database');
    this.adapterConfigs['database'] = config;
    await this.persistStepCompletion('database');

    this.logger.info({ provider: config.provider, latencyMs: result.latencyMs }, 'Database configured');
    return result;
  }

  /**
   * Configure Storage adapter (Step 3).
   */
  async configureStorage(config: StorageConfigInput): Promise<ValidationResult> {
    this.logger.info({ adapter: config.adapter, bucket: config.bucket }, 'Configuring storage');

    await this.ensureActiveRun();

    const orderError = this.checkStepOrder('storage');
    if (orderError) return orderError;

    const result = await this.storageValidator.validate(config);
    if (!result.success) {
      this.logger.warn({ error: result.error }, 'Storage validation failed');
      return result;
    }

    if (this.connectivityTester.testStorage) {
      const connectivity = await this.connectivityTester.testStorage(config);
      if (!connectivity.healthy) {
        return {
          success: false,
          step: 'storage',
          message: 'Storage connectivity test failed',
          error: connectivity.error ?? 'Unable to connect to storage',
          latencyMs: connectivity.latencyMs,
        };
      }
      result.latencyMs = connectivity.latencyMs;
    }

    this.completedSteps.add('storage');
    this.adapterConfigs['storage'] = config;
    await this.persistStepCompletion('storage');

    this.logger.info({ adapter: config.adapter, latencyMs: result.latencyMs }, 'Storage configured');
    return result;
  }

  /**
   * Configure Cache adapter (Step 4).
   */
  async configureCache(config: CacheConfigInput): Promise<ValidationResult> {
    this.logger.info({ adapter: config.adapter }, 'Configuring cache');

    await this.ensureActiveRun();

    const orderError = this.checkStepOrder('cache');
    if (orderError) return orderError;

    const result = await this.cacheValidator.validate(config);
    if (!result.success) {
      this.logger.warn({ error: result.error }, 'Cache validation failed');
      return result;
    }

    if (this.connectivityTester.testCache) {
      const connectivity = await this.connectivityTester.testCache(config);
      if (!connectivity.healthy) {
        return {
          success: false,
          step: 'cache',
          message: 'Cache connectivity test failed',
          error: connectivity.error ?? 'Unable to connect to cache',
          latencyMs: connectivity.latencyMs,
        };
      }
      result.latencyMs = connectivity.latencyMs;
    }

    this.completedSteps.add('cache');
    this.adapterConfigs['cache'] = config;
    await this.persistStepCompletion('cache');

    this.logger.info({ adapter: config.adapter, latencyMs: result.latencyMs }, 'Cache configured');
    return result;
  }

  /**
   * Configure Queue adapter (Step 5).
   */
  async configureQueue(config: QueueConfigInput): Promise<ValidationResult> {
    this.logger.info({ backend: config.backend }, 'Configuring queue');

    await this.ensureActiveRun();

    const orderError = this.checkStepOrder('queue');
    if (orderError) return orderError;

    const result = await this.queueValidator.validate(config);
    if (!result.success) {
      this.logger.warn({ error: result.error }, 'Queue validation failed');
      return result;
    }

    if (this.connectivityTester.testQueue) {
      const connectivity = await this.connectivityTester.testQueue(config);
      if (!connectivity.healthy) {
        return {
          success: false,
          step: 'queue',
          message: 'Queue connectivity test failed',
          error: connectivity.error ?? 'Unable to connect to queue',
          latencyMs: connectivity.latencyMs,
        };
      }
      result.latencyMs = connectivity.latencyMs;
    }

    this.completedSteps.add('queue');
    this.adapterConfigs['queue'] = config;
    await this.persistStepCompletion('queue');

    this.logger.info({ backend: config.backend, latencyMs: result.latencyMs }, 'Queue configured');
    return result;
  }

  /**
   * Finalize the bootstrap process.
   * All steps must be completed before finalization.
   * This is the all-or-nothing gate.
   */
  async finalizeBootstrap(): Promise<BootstrapResult> {
    this.logger.info('Finalizing bootstrap');

    // Check all steps are completed
    const missingSteps = BOOTSTRAP_STEPS.filter((s) => !this.completedSteps.has(s));
    if (missingSteps.length > 0) {
      const error = `Cannot finalize: missing steps: ${missingSteps.join(', ')}`;
      this.logger.error({ missingSteps }, error);

      // Mark run as failed
      if (this.currentRunId) {
        await this.store.updateRun(this.currentRunId, {
          status: 'failed',
          error,
        });
      }

      return {
        success: false,
        runId: this.currentRunId ?? 'none',
        completedAt: new Date().toISOString(),
        adapters: Object.fromEntries(
          BOOTSTRAP_STEPS.map((step) => [
            step,
            this.completedSteps.has(step) ? 'configured' : 'pending',
          ]),
        ) as Record<BootstrapStep, AdapterStatus>,
        error,
      };
    }

    // Mark run as completed
    const completedAt = new Date().toISOString();
    if (this.currentRunId) {
      await this.store.updateRun(this.currentRunId, {
        status: 'completed',
        completedSteps: [...BOOTSTRAP_STEPS],
        adapterConfigs: this.adapterConfigs as Record<BootstrapStep, unknown>,
        completedAt,
      });
    }

    this.isBootstrapped = true;

    this.logger.info({ runId: this.currentRunId }, 'Bootstrap completed successfully');

    return {
      success: true,
      runId: this.currentRunId ?? uuid(),
      completedAt,
      adapters: Object.fromEntries(
        BOOTSTRAP_STEPS.map((step) => [step, 'configured' as AdapterStatus]),
      ) as Record<BootstrapStep, AdapterStatus>,
    };
  }

  /**
   * Aggregate health checks from all configured adapters.
   */
  async getAdapterHealth(): Promise<AggregatedHealth> {
    const checkedAt = new Date().toISOString();
    const adapters: Record<string, AdapterHealth> = {};

    // Check each configured adapter
    for (const step of BOOTSTRAP_STEPS) {
      if (!this.completedSteps.has(step)) {
        adapters[step] = {
          healthy: false,
          adapter: step,
          latencyMs: 0,
          message: 'Not configured',
          checkedAt,
        };
        continue;
      }

      const config = this.adapterConfigs[step];
      const health = await this.checkAdapterHealth(step, config);
      adapters[step] = health;
    }

    // Determine overall status
    const healthyCount = Object.values(adapters).filter((a) => a.healthy).length;
    const totalCount = Object.values(adapters).length;

    let status: AggregatedHealth['status'];
    if (healthyCount === totalCount) {
      status = 'healthy';
    } else if (healthyCount === 0) {
      status = 'unhealthy';
    } else {
      status = 'degraded';
    }

    return { status, adapters, checkedAt };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Ensures there's an active bootstrap run. Creates one if needed.
   */
  private async ensureActiveRun(): Promise<void> {
    if (this.currentRunId) return;

    this.currentRunId = uuid();
    const run: BootstrapRunRecord = {
      id: this.currentRunId,
      status: 'in_progress',
      completedSteps: [],
      adapterConfigs: {} as Record<BootstrapStep, unknown>,
      startedAt: new Date().toISOString(),
    };

    await this.store.createRun(run);
    this.logger.info({ runId: this.currentRunId }, 'Started new bootstrap run');
  }

  /**
   * Checks that all prerequisite steps are completed before the given step.
   * Enforces the ordered configuration flow.
   */
  private checkStepOrder(step: BootstrapStep): ValidationResult | null {
    const stepIndex = BOOTSTRAP_STEPS.indexOf(step);
    const requiredSteps = BOOTSTRAP_STEPS.slice(0, stepIndex);
    const missingPrereqs = requiredSteps.filter((s) => !this.completedSteps.has(s));

    if (missingPrereqs.length > 0) {
      return {
        success: false,
        step,
        message: `Cannot configure "${step}": prerequisite steps not completed`,
        error: `Missing prerequisites: ${missingPrereqs.join(', ')}`,
      };
    }

    return null;
  }

  /**
   * Persists the completion of a step to the store.
   */
  private async persistStepCompletion(step: BootstrapStep): Promise<void> {
    if (!this.currentRunId) return;

    await this.store.updateRun(this.currentRunId, {
      completedSteps: Array.from(this.completedSteps),
      adapterConfigs: this.adapterConfigs as Record<BootstrapStep, unknown>,
    });
  }

  /**
   * Checks health of a specific adapter using the connectivity tester.
   */
  private async checkAdapterHealth(step: BootstrapStep, config: unknown): Promise<AdapterHealth> {
    const checkedAt = new Date().toISOString();
    const start = Date.now();

    try {
      switch (step) {
        case 'cdn': {
          if (this.connectivityTester.testCdn) {
            const result = await this.connectivityTester.testCdn(config as CdnConfigInput);
            return {
              healthy: result.healthy,
              adapter: 'cdn',
              latencyMs: result.latencyMs,
              message: result.healthy ? 'CDN is reachable' : (result.error ?? 'CDN unreachable'),
              checkedAt,
            };
          }
          break;
        }
        case 'database': {
          if (this.connectivityTester.testDatabase) {
            const result = await this.connectivityTester.testDatabase(config as DatabaseConfigInput);
            return {
              healthy: result.healthy,
              adapter: 'database',
              latencyMs: result.latencyMs,
              message: result.healthy ? 'Database is connected' : (result.error ?? 'Database unreachable'),
              checkedAt,
            };
          }
          break;
        }
        case 'storage': {
          if (this.connectivityTester.testStorage) {
            const result = await this.connectivityTester.testStorage(config as StorageConfigInput);
            return {
              healthy: result.healthy,
              adapter: 'storage',
              latencyMs: result.latencyMs,
              message: result.healthy ? 'Storage is accessible' : (result.error ?? 'Storage unreachable'),
              checkedAt,
            };
          }
          break;
        }
        case 'cache': {
          if (this.connectivityTester.testCache) {
            const result = await this.connectivityTester.testCache(config as CacheConfigInput);
            return {
              healthy: result.healthy,
              adapter: 'cache',
              latencyMs: result.latencyMs,
              message: result.healthy ? 'Cache is responding' : (result.error ?? 'Cache unreachable'),
              checkedAt,
            };
          }
          break;
        }
        case 'queue': {
          if (this.connectivityTester.testQueue) {
            const result = await this.connectivityTester.testQueue(config as QueueConfigInput);
            return {
              healthy: result.healthy,
              adapter: 'queue',
              latencyMs: result.latencyMs,
              message: result.healthy ? 'Queue is connected' : (result.error ?? 'Queue unreachable'),
              checkedAt,
            };
          }
          break;
        }
      }

      // No connectivity tester available — assume healthy if configured
      return {
        healthy: true,
        adapter: step,
        latencyMs: Date.now() - start,
        message: `${step} is configured (no connectivity tester available)`,
        checkedAt,
      };
    } catch (err) {
      return {
        healthy: false,
        adapter: step,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Health check failed',
        checkedAt,
      };
    }
  }
}
