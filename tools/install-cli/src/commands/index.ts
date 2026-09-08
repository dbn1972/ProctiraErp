/**
 * Commands barrel export for the install-cli.
 */

export { validateCommand, runValidation } from './validate';
export type { ValidationReport, CheckResult, CheckStatus, ValidateOptions } from './validate';

export { healthCommand, runHealthCheck } from './health';
export type { HealthReport, HealthCheckResult, HealthOptions } from './health';

export { readinessCommand, runReadinessCheck } from './readiness';
export type {
  ReadinessReport,
  ReadinessCategory,
  ReadinessStatus,
  ReadinessOptions,
} from './readiness';

export { diagnosticsCommand, generateDiagnosticBundle } from './diagnostics';
export type { DiagnosticBundle, ServiceStatus, DiagnosticsOptions } from './diagnostics';

export { upgradeCheckCommand, runUpgradeCheck } from './upgrade-check';
export type {
  UpgradeCheckResult,
  CompatibilityCheck,
  UpgradeDecision,
  UpgradeCheckOptions,
} from './upgrade-check';
