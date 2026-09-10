/**
 * SLO Catalog — predefined SLO definitions for all critical ProctiraERP services.
 *
 * Each entry defines the service's SLIs (availability, latency, error rate,
 * saturation, and optionally queue lag), alert rules, runbook URL, owning team,
 * and dependencies.
 *
 * Services import their definition from this catalog and pass it to
 * `registerServiceSLO()` at startup.
 *
 * Charter: Section 38 (SLO, SLI, Service Operations)
 */
import {
  buildServiceSLO,
  DEFAULT_CORE_SERVICE_INDICATORS,
  DEFAULT_GATEWAY_INDICATORS,
  DEFAULT_WORKER_INDICATORS,
  type ServiceSLO,
} from './slo.js';

// ─── Gateway ────────────────────────────────────────────────────────────────

export const API_GATEWAY_SLO: ServiceSLO = buildServiceSLO({
  service: 'api-gateway',
  owner: 'Platform Engineering',
  indicators: {
    ...DEFAULT_GATEWAY_INDICATORS,
  },
  slackChannel: '#proctira-platform',
  oncallGroup: 'api-gateway-oncall',
  dependencies: ['auth', 'tenant', 'redis'],
});

// ─── Core Domain Services ───────────────────────────────────────────────────

export const AUTH_SLO: ServiceSLO = buildServiceSLO({
  service: 'auth',
  owner: 'Security Engineering',
  indicators: {
    ...DEFAULT_CORE_SERVICE_INDICATORS,
    latency: { p95: 200, p99: 500, unit: 'ms' },
  },
  slackChannel: '#proctira-security',
  oncallGroup: 'auth-oncall',
  dependencies: ['postgresql', 'redis'],
});

export const INSTITUTION_SLO: ServiceSLO = buildServiceSLO({
  service: 'institution',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'institution-oncall',
  dependencies: ['postgresql', 'kafka'],
});

export const STUDENT_SLO: ServiceSLO = buildServiceSLO({
  service: 'student',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'student-oncall',
  dependencies: ['postgresql', 'kafka', 'rabbitmq'],
});

export const STAFF_SLO: ServiceSLO = buildServiceSLO({
  service: 'staff',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'staff-oncall',
  dependencies: ['postgresql', 'kafka'],
});

export const ASSESSMENT_SLO: ServiceSLO = buildServiceSLO({
  service: 'assessment',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'assessment-oncall',
  dependencies: ['postgresql', 'rabbitmq'],
});

export const ATTENDANCE_SLO: ServiceSLO = buildServiceSLO({
  service: 'attendance',
  owner: 'Engineering',
  indicators: {
    ...DEFAULT_CORE_SERVICE_INDICATORS,
    latency: { p95: 200, p99: 400, unit: 'ms' },
  },
  slackChannel: '#proctira-engineering',
  oncallGroup: 'attendance-oncall',
  dependencies: ['postgresql', 'kafka'],
});

export const EXAMINATION_SLO: ServiceSLO = buildServiceSLO({
  service: 'examination',
  owner: 'Engineering',
  indicators: {
    ...DEFAULT_CORE_SERVICE_INDICATORS,
    queueLag: { maxLag: 500, unit: 'messages' },
  },
  slackChannel: '#proctira-engineering',
  oncallGroup: 'examination-oncall',
  dependencies: ['postgresql', 'rabbitmq', 'kafka'],
});

export const SCHOLARSHIP_SLO: ServiceSLO = buildServiceSLO({
  service: 'scholarship',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'scholarship-oncall',
  dependencies: ['postgresql', 'workflow'],
});

export const HEALTH_SLO: ServiceSLO = buildServiceSLO({
  service: 'health',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'health-oncall',
  dependencies: ['postgresql'],
});

// ─── Platform Services ──────────────────────────────────────────────────────

export const WORKFLOW_SLO: ServiceSLO = buildServiceSLO({
  service: 'workflow',
  owner: 'Engineering',
  indicators: {
    ...DEFAULT_CORE_SERVICE_INDICATORS,
    queueLag: { maxLag: 500, unit: 'messages' },
  },
  slackChannel: '#proctira-engineering',
  oncallGroup: 'workflow-oncall',
  dependencies: ['postgresql', 'kafka', 'rabbitmq'],
});

export const NOTIFICATION_SLO: ServiceSLO = buildServiceSLO({
  service: 'notification',
  owner: 'Engineering',
  indicators: {
    ...DEFAULT_CORE_SERVICE_INDICATORS,
    queueLag: { maxLag: 2000, unit: 'messages' },
  },
  slackChannel: '#proctira-engineering',
  oncallGroup: 'notification-oncall',
  dependencies: ['postgresql', 'rabbitmq', 'redis', 'kafka'],
});

export const AUDIT_SLO: ServiceSLO = buildServiceSLO({
  service: 'audit',
  owner: 'Security Engineering',
  indicators: {
    ...DEFAULT_CORE_SERVICE_INDICATORS,
    latency: { p95: 100, p99: 300, unit: 'ms' },
  },
  slackChannel: '#proctira-security',
  oncallGroup: 'audit-oncall',
  dependencies: ['postgresql'],
});

export const REPORT_SLO: ServiceSLO = buildServiceSLO({
  service: 'report',
  owner: 'Engineering',
  indicators: {
    ...DEFAULT_WORKER_INDICATORS,
    latency: { p95: 5000, p99: 30000, unit: 'ms' },
  },
  slackChannel: '#proctira-engineering',
  oncallGroup: 'report-oncall',
  dependencies: ['postgresql', 'rabbitmq', 's3'],
});

export const SURVEY_SLO: ServiceSLO = buildServiceSLO({
  service: 'survey',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'survey-oncall',
  dependencies: ['postgresql'],
});

export const CUSTOM_FIELD_SLO: ServiceSLO = buildServiceSLO({
  service: 'custom-field',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'custom-field-oncall',
  dependencies: ['postgresql'],
});

export const TRANSPORT_SLO: ServiceSLO = buildServiceSLO({
  service: 'transport',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'transport-oncall',
  dependencies: ['postgresql'],
});

// ─── Data and ETL ───────────────────────────────────────────────────────────

export const ETL_SLO: ServiceSLO = buildServiceSLO({
  service: 'etl',
  owner: 'Ops Engineering',
  indicators: {
    ...DEFAULT_WORKER_INDICATORS,
    queueLag: { maxLag: 5000, unit: 'messages' },
  },
  slackChannel: '#proctira-ops',
  oncallGroup: 'etl-oncall',
  dependencies: ['postgresql', 'kafka', 'rabbitmq'],
});

export const DATA_WAREHOUSE_SLO: ServiceSLO = buildServiceSLO({
  service: 'data-warehouse',
  owner: 'Ops Engineering',
  indicators: {
    ...DEFAULT_WORKER_INDICATORS,
    latency: { p95: 3000, p99: 10000, unit: 'ms' },
  },
  slackChannel: '#proctira-ops',
  oncallGroup: 'data-warehouse-oncall',
  dependencies: ['postgresql', 'kafka'],
});

// ─── Lifecycle Services ─────────────────────────────────────────────────────

export const REGISTRATION_SLO: ServiceSLO = buildServiceSLO({
  service: 'registration',
  owner: 'Engineering',
  indicators: DEFAULT_CORE_SERVICE_INDICATORS,
  slackChannel: '#proctira-engineering',
  oncallGroup: 'registration-oncall',
  dependencies: ['postgresql', 'workflow'],
});

export const TENANT_SLO: ServiceSLO = buildServiceSLO({
  service: 'tenant',
  owner: 'Platform Engineering',
  indicators: {
    ...DEFAULT_CORE_SERVICE_INDICATORS,
    latency: { p95: 200, p99: 500, unit: 'ms' },
  },
  slackChannel: '#proctira-platform',
  oncallGroup: 'tenant-oncall',
  dependencies: ['postgresql', 'redis'],
});

// ─── Full catalog for programmatic access ───────────────────────────────────

/**
 * Complete catalog of all service SLO definitions.
 * Keyed by service slug for easy lookup.
 */
export const SLO_CATALOG: Record<string, ServiceSLO> = {
  'api-gateway': API_GATEWAY_SLO,
  auth: AUTH_SLO,
  institution: INSTITUTION_SLO,
  student: STUDENT_SLO,
  staff: STAFF_SLO,
  assessment: ASSESSMENT_SLO,
  attendance: ATTENDANCE_SLO,
  examination: EXAMINATION_SLO,
  scholarship: SCHOLARSHIP_SLO,
  health: HEALTH_SLO,
  workflow: WORKFLOW_SLO,
  notification: NOTIFICATION_SLO,
  audit: AUDIT_SLO,
  report: REPORT_SLO,
  survey: SURVEY_SLO,
  'custom-field': CUSTOM_FIELD_SLO,
  transport: TRANSPORT_SLO,
  etl: ETL_SLO,
  'data-warehouse': DATA_WAREHOUSE_SLO,
  registration: REGISTRATION_SLO,
  tenant: TENANT_SLO,
};
