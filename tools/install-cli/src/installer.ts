/**
 * Installer - Orchestrates the full installation process.
 *
 * Steps:
 * 1. Validate all adapter configurations via InstallService
 * 2. Run database migrations (via Prisma)
 * 3. Create initial platform admin account
 * 4. Run health checks and output summary
 */

import {
  InstallServiceImpl,
  InMemoryBootstrapStore,
  type BootstrapStore,
  type ConnectivityTester,
  type ValidationResult,
} from '@proctira/backend-install';

import type { InstallConfig, InstallResult, AdminAccountConfig } from './types';

/**
 * Logger interface for the installer.
 */
export interface InstallerLogger {
  info(msg: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Migration runner interface.
 * Abstracted to allow testing without real Prisma.
 */
export interface MigrationRunner {
  /** Run pending database migrations */
  runMigrations(): Promise<{ success: boolean; migrationsApplied: number; error?: string }>;
}

/**
 * Admin account creator interface.
 * Abstracted to allow testing without real database.
 */
export interface AdminAccountCreator {
  /** Create the initial platform admin account */
  createAdmin(
    admin: AdminAccountConfig,
  ): Promise<{ success: boolean; userId?: string; error?: string; delegated?: boolean }>;
}

/**
 * Dependencies for the Installer.
 */
export interface InstallerDependencies {
  logger: InstallerLogger;
  migrationRunner?: MigrationRunner;
  adminCreator?: AdminAccountCreator;
  /** PRC-H102: persistent bootstrap run store (default: in-memory). */
  store?: BootstrapStore;
  /** PRC-H102: real connectivity probes (default: none — configuration-only checks). */
  connectivityTester?: ConnectivityTester;
  /** PRC-H102: optional extra post-install probes (e.g. IdP OIDC discovery). */
  extraHealthChecks?: Array<{
    name: string;
    check: () => Promise<{ healthy: boolean; error?: string }>;
  }>;
}

/** Error returned by the built-in placeholders; never reported as success. */
export const NOT_IMPLEMENTED_MIGRATIONS =
  'not implemented: no MigrationRunner configured. Apply migrations with ' +
  'tools/scripts/run-target-database-migrations.sh and re-run with --skip-migrations, ' +
  'or inject a real MigrationRunner.';
export const NOT_IMPLEMENTED_ADMIN =
  'not implemented: no AdminAccountCreator configured. Create the platform admin through ' +
  'the identity provider and re-run with --skip-admin, or inject a real AdminAccountCreator.';

/**
 * Placeholder used when no real migration runner is injected. It fails the
 * install instead of pretending that migrations were applied.
 */
export class NotImplementedMigrationRunner implements MigrationRunner {
  constructor(private readonly logger: InstallerLogger) {}

  runMigrations(): Promise<{ success: boolean; migrationsApplied: number; error?: string }> {
    this.logger.error(NOT_IMPLEMENTED_MIGRATIONS);
    return Promise.resolve({
      success: false,
      migrationsApplied: 0,
      error: NOT_IMPLEMENTED_MIGRATIONS,
    });
  }
}

/**
 * Placeholder used when no real admin creator is injected. It fails the install
 * instead of returning a fabricated user id.
 */
export class NotImplementedAdminCreator implements AdminAccountCreator {
  constructor(private readonly logger: InstallerLogger) {}

  createAdmin(
    _admin: AdminAccountConfig,
  ): Promise<{ success: boolean; userId?: string; error?: string }> {
    this.logger.error(NOT_IMPLEMENTED_ADMIN);
    return Promise.resolve({ success: false, error: NOT_IMPLEMENTED_ADMIN });
  }
}

/**
 * Main installer class that orchestrates the full installation.
 */
export class Installer {
  private readonly logger: InstallerLogger;
  private readonly migrationRunner: MigrationRunner;
  private readonly adminCreator: AdminAccountCreator;
  private readonly store: BootstrapStore;
  private readonly connectivityTester: ConnectivityTester | undefined;
  private readonly extraHealthChecks: NonNullable<InstallerDependencies['extraHealthChecks']>;

  constructor(deps: InstallerDependencies) {
    this.logger = deps.logger;
    this.store = deps.store ?? new InMemoryBootstrapStore();
    this.connectivityTester = deps.connectivityTester;
    this.extraHealthChecks = deps.extraHealthChecks ?? [];
    this.migrationRunner = deps.migrationRunner ?? new NotImplementedMigrationRunner(deps.logger);
    this.adminCreator = deps.adminCreator ?? new NotImplementedAdminCreator(deps.logger);
  }

  /**
   * Run the full installation process.
   */
  async install(
    config: InstallConfig,
    options?: { skipMigrations?: boolean; skipAdmin?: boolean },
  ): Promise<InstallResult> {
    const startTime = Date.now();
    const adapterResults: Record<
      string,
      { success: boolean; message: string; latencyMs?: number }
    > = {};

    this.logger.info('Starting ProctiraERP platform installation...');

    // Create install service instance
    const installService = new InstallServiceImpl({
      logger: this.logger,
      store: this.store,
      ...(this.connectivityTester ? { connectivityTester: this.connectivityTester } : {}),
    });

    // Step 1: Validate and configure all adapters
    this.logger.info('Step 1/4: Validating adapter configurations...');

    // CDN
    const cdnResult = await installService.configureCDN(config.cdn);
    adapterResults['cdn'] = {
      success: cdnResult.success,
      message: cdnResult.message,
      latencyMs: cdnResult.latencyMs,
    };
    if (!cdnResult.success) {
      return this.buildFailureResult(adapterResults, cdnResult, 'CDN configuration failed');
    }
    this.logger.info(`  ✓ CDN: ${cdnResult.message}`);

    // Database
    const dbResult = await installService.configureDatabase(config.database);
    adapterResults['database'] = {
      success: dbResult.success,
      message: dbResult.message,
      latencyMs: dbResult.latencyMs,
    };
    if (!dbResult.success) {
      return this.buildFailureResult(adapterResults, dbResult, 'Database configuration failed');
    }
    this.logger.info(`  ✓ Database: ${dbResult.message}`);

    // Storage
    const storageResult = await installService.configureStorage(config.storage);
    adapterResults['storage'] = {
      success: storageResult.success,
      message: storageResult.message,
      latencyMs: storageResult.latencyMs,
    };
    if (!storageResult.success) {
      return this.buildFailureResult(adapterResults, storageResult, 'Storage configuration failed');
    }
    this.logger.info(`  ✓ Storage: ${storageResult.message}`);

    // Cache
    const cacheResult = await installService.configureCache(config.cache);
    adapterResults['cache'] = {
      success: cacheResult.success,
      message: cacheResult.message,
      latencyMs: cacheResult.latencyMs,
    };
    if (!cacheResult.success) {
      return this.buildFailureResult(adapterResults, cacheResult, 'Cache configuration failed');
    }
    this.logger.info(`  ✓ Cache: ${cacheResult.message}`);

    // Queue
    const queueResult = await installService.configureQueue(config.queue);
    adapterResults['queue'] = {
      success: queueResult.success,
      message: queueResult.message,
      latencyMs: queueResult.latencyMs,
    };
    if (!queueResult.success) {
      return this.buildFailureResult(adapterResults, queueResult, 'Queue configuration failed');
    }
    this.logger.info(`  ✓ Queue: ${queueResult.message}`);

    // Finalize bootstrap
    const bootstrapResult = await installService.finalizeBootstrap();
    if (!bootstrapResult.success) {
      return this.buildFailureResult(
        adapterResults,
        undefined,
        bootstrapResult.error ?? 'Bootstrap finalization failed',
      );
    }
    this.logger.info('  ✓ All adapters validated and configured');

    // Step 2: Run database migrations
    let migrationsRun = false;
    if (!options?.skipMigrations) {
      this.logger.info('Step 2/4: Running database migrations...');
      const migrationResult = await this.migrationRunner.runMigrations();
      if (!migrationResult.success) {
        return {
          success: false,
          completedAt: new Date().toISOString(),
          adapterResults,
          migrationsRun: false,
          adminCreated: false,
          health: { status: 'unhealthy', adapters: {} },
          error: `Migration failed: ${migrationResult.error ?? 'unknown error'}`,
        };
      }
      migrationsRun = true;
      this.logger.info(`  ✓ Migrations applied: ${migrationResult.migrationsApplied}`);
    } else {
      this.logger.info('Step 2/4: Skipping database migrations (--skip-migrations)');
    }

    // Step 3: Create admin account
    let adminCreated = false;
    if (!options?.skipAdmin) {
      this.logger.info('Step 3/4: Creating platform admin account...');
      const adminResult = await this.adminCreator.createAdmin(config.admin);
      if (!adminResult.success) {
        return {
          success: false,
          completedAt: new Date().toISOString(),
          adapterResults,
          migrationsRun,
          adminCreated: false,
          health: { status: 'unhealthy', adapters: {} },
          error: `Admin account creation failed: ${adminResult.error ?? 'unknown error'}`,
        };
      }
      if (adminResult.delegated) {
        this.logger.info(`  ✓ Admin account delegated to the identity provider (none created)`);
      } else {
        adminCreated = true;
        this.logger.info(`  ✓ Admin account created: ${config.admin.username}`);
      }
    } else {
      this.logger.info('Step 3/4: Skipping admin account creation (--skip-admin)');
    }

    // Step 4: Health check
    this.logger.info('Step 4/4: Running health checks...');
    const healthResult = await installService.getAdapterHealth();
    const health = {
      status: healthResult.status,
      adapters: Object.fromEntries(
        Object.entries(healthResult.adapters).map(([key, val]) => [
          key,
          { healthy: val.healthy, message: val.message },
        ]),
      ),
    };
    for (const extra of this.extraHealthChecks) {
      const r = await extra.check();
      health.adapters[extra.name] = {
        healthy: r.healthy,
        message: r.healthy ? `${extra.name} reachable` : (r.error ?? `${extra.name} unreachable`),
      };
    }
    const unhealthy = Object.entries(health.adapters).filter(([, v]) => !v.healthy);
    if (healthResult.status === 'unhealthy' || unhealthy.length > 0) {
      // PRC-H102: never report a successful install while a dependency is down.
      return {
        success: false,
        completedAt: new Date().toISOString(),
        adapterResults,
        migrationsRun,
        adminCreated,
        health: { ...health, status: 'unhealthy' },
        error: `Post-install health check failed: ${unhealthy.map(([k]) => k).join(', ') || healthResult.status}`,
      };
    }
    this.logger.info(`  ✓ Health status: ${healthResult.status}`);

    const elapsed = Date.now() - startTime;
    this.logger.info(`\nInstallation completed in ${elapsed}ms`);

    return {
      success: true,
      completedAt: new Date().toISOString(),
      adapterResults,
      migrationsRun,
      adminCreated,
      health,
    };
  }

  /**
   * Build a failure result when an adapter configuration fails.
   */
  private buildFailureResult(
    adapterResults: Record<string, { success: boolean; message: string; latencyMs?: number }>,
    failedResult: ValidationResult | undefined,
    errorMessage: string,
  ): InstallResult {
    return {
      success: false,
      completedAt: new Date().toISOString(),
      adapterResults,
      migrationsRun: false,
      adminCreated: false,
      health: { status: 'unhealthy', adapters: {} },
      error: failedResult?.error ?? errorMessage,
    };
  }
}
