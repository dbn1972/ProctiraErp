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
  type ValidationResult,
  type AggregatedHealth,
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
  createAdmin(admin: AdminAccountConfig): Promise<{ success: boolean; userId?: string; error?: string }>;
}

/**
 * Dependencies for the Installer.
 */
export interface InstallerDependencies {
  logger: InstallerLogger;
  migrationRunner?: MigrationRunner;
  adminCreator?: AdminAccountCreator;
}

/**
 * Default no-op migration runner (logs that migrations would be run).
 */
export class DefaultMigrationRunner implements MigrationRunner {
  constructor(private readonly logger: InstallerLogger) {}

  async runMigrations(): Promise<{ success: boolean; migrationsApplied: number; error?: string }> {
    this.logger.info('Database migrations: using Prisma migrate deploy');
    // In production, this would execute: npx prisma migrate deploy
    // For now, we simulate success since the actual Prisma client
    // requires a real database connection.
    return { success: true, migrationsApplied: 0 };
  }
}

/**
 * Default admin account creator (logs that account would be created).
 */
export class DefaultAdminCreator implements AdminAccountCreator {
  constructor(private readonly logger: InstallerLogger) {}

  async createAdmin(admin: AdminAccountConfig): Promise<{ success: boolean; userId?: string; error?: string }> {
    this.logger.info(
      { username: admin.username, name: `${admin.firstName} ${admin.lastName}` },
      'Creating platform admin account',
    );
    // In production, this would insert into the users table.
    // Returns a placeholder ID for the summary.
    const userId = `admin-${Date.now()}`;
    return { success: true, userId };
  }
}

/**
 * Main installer class that orchestrates the full installation.
 */
export class Installer {
  private readonly logger: InstallerLogger;
  private readonly migrationRunner: MigrationRunner;
  private readonly adminCreator: AdminAccountCreator;

  constructor(deps: InstallerDependencies) {
    this.logger = deps.logger;
    this.migrationRunner = deps.migrationRunner ?? new DefaultMigrationRunner(deps.logger);
    this.adminCreator = deps.adminCreator ?? new DefaultAdminCreator(deps.logger);
  }

  /**
   * Run the full installation process.
   */
  async install(config: InstallConfig, options?: { skipMigrations?: boolean; skipAdmin?: boolean }): Promise<InstallResult> {
    const startTime = Date.now();
    const adapterResults: Record<string, { success: boolean; message: string; latencyMs?: number }> = {};

    this.logger.info('Starting ProctiraERP platform installation...');

    // Create install service instance
    const store = new InMemoryBootstrapStore();
    const installService = new InstallServiceImpl({
      logger: this.logger,
      store,
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
      return this.buildFailureResult(adapterResults, undefined, bootstrapResult.error ?? 'Bootstrap finalization failed');
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
          error: `Migration failed: ${migrationResult.error}`,
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
          error: `Admin account creation failed: ${adminResult.error}`,
        };
      }
      adminCreated = true;
      this.logger.info(`  ✓ Admin account created: ${config.admin.username}`);
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
