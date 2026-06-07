/**
 * @proctira/install-cli - CLI tool for headless/automated installation
 *
 * Provides a command-line interface for installing and configuring
 * the ProctiraERP Unified Platform. Supports three configuration modes:
 * - JSON configuration file (--config)
 * - Environment variables (--env)
 * - Interactive prompts (default)
 *
 * Charter: Section 17.2 (Setup Experience)
 */

// CLI entry point
export { run, parseArgs, formatResultText, createConsoleLogger } from './cli';

// Installer
export { Installer, DefaultMigrationRunner, DefaultAdminCreator } from './installer';
export type {
  InstallerLogger,
  InstallerDependencies,
  MigrationRunner,
  AdminAccountCreator,
} from './installer';

// Config loader
export {
  loadConfigFromFile,
  loadConfigFromEnv,
  loadConfigInteractive,
  validateConfigStructure,
} from './config-loader';

// Types
export type {
  CliOptions,
  ConfigSource,
  InstallConfig,
  InstallResult,
  AdminAccountConfig,
} from './types';
export { ENV_VAR_MAP } from './types';

// Commands (Volume 11 — Enterprise Installation & Readiness)
export {
  validateCommand,
  runValidation,
  healthCommand,
  runHealthCheck,
  readinessCommand,
  runReadinessCheck,
  diagnosticsCommand,
  generateDiagnosticBundle,
  upgradeCheckCommand,
  runUpgradeCheck,
} from './commands';
export type {
  ValidationReport,
  CheckResult,
  CheckStatus,
  ValidateOptions,
  HealthReport,
  HealthCheckResult,
  HealthOptions,
  ReadinessReport,
  ReadinessCategory,
  ReadinessStatus,
  ReadinessOptions,
  DiagnosticBundle,
  ServiceStatus,
  DiagnosticsOptions,
  UpgradeCheckResult,
  CompatibilityCheck,
  UpgradeDecision,
  UpgradeCheckOptions,
} from './commands';
