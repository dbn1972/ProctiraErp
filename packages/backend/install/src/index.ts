/**
 * @proctira/backend-install - Install/Bootstrap Service
 *
 * Manages first-run configuration and adapter validation for the
 * ProctiraERP Unified Platform. Provides a step-by-step configuration
 * flow (CDN → Database → Storage → Cache → Queue) with connectivity
 * testing and all-or-nothing bootstrap semantics.
 *
 * Features:
 * - Fastify plugin with REST routes for bootstrap configuration
 * - Step-by-step ordered configuration flow
 * - Adapter validation and connectivity testing
 * - All-or-nothing bootstrap (prevents partial invalid initialization)
 * - Bootstrap run persistence (install_bootstrap_runs table)
 * - Health check aggregation for all configured adapters
 *
 * Charter: Section 17 (First-Run Configuration)
 */

// Core service
export { InstallServiceImpl } from './install-service';
export type { InstallServiceDependencies, ConnectivityTester } from './install-service';

// Fastify plugin
export { installPlugin } from './install-plugin';
export type { InstallPluginOptions } from './install-plugin';

// Store
export { InMemoryBootstrapStore, DatabaseBootstrapStore } from './bootstrap-store';
export type { BootstrapStore } from './bootstrap-store';

// Validators
export {
  CdnValidator,
  DatabaseValidator,
  StorageValidator,
  CacheValidator,
  QueueValidator,
} from './adapter-validators';
export type { AdapterValidator } from './adapter-validators';

// Types
export type {
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

export {
  BOOTSTRAP_STEPS,
  CdnConfigSchema,
  DatabaseConfigSchema,
  StorageConfigSchema,
  CacheConfigSchema,
  QueueConfigSchema,
} from './types';
