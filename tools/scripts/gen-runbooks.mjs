#!/usr/bin/env node
/**
 * Generate one runbook per ProctiraERP service from a single template.
 * Output: docs/runbooks/<slug>.md
 *
 * Idempotent — re-running overwrites the runbooks. Hand-edit only after
 * the initial scaffold is in place; subsequent runs will clobber edits.
 *
 * Usage: node tools/scripts/gen-runbooks.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../../docs/runbooks');

const SERVICES = [
  ['api-gateway', 'API Gateway', 'Platform Engineering', '#proctira-platform', 3000,
    'The API Gateway is the single ingress for all platform traffic. It terminates TLS, enforces authentication and per-tenant rate limits, applies CORS, and routes versioned URLs (/api/v1/...) to the appropriate backend service.',
    ['auth', 'tenant', 'every backend service downstream', 'Redis (rate limit store)']],
  ['auth', 'Auth Service', 'Security Engineering', '#proctira-security', 3001,
    'Issues access and refresh tokens, validates credentials, brokers external identity providers (Google/Microsoft/OIDC/SAML), and exposes session/lockout management. All authentication paths flow through this service.',
    ['PostgreSQL (users, refresh tokens, sessions)', 'Redis (session cache, lockout counters)', 'external IdP endpoints']],
  ['institution', 'Institution Service', 'Domain Engineering', '#proctira-domain', 3002,
    'Manages institutions, academic periods, area hierarchies, infrastructure inventories, and education systems. Backbone reference data for almost every other service.',
    ['PostgreSQL (institutions DB)', 'audit (write events)']],
  ['student', 'Student Service', 'Domain Engineering', '#proctira-domain', 3003,
    'Tracks student profiles, enrolments, transitions, guardians, and behaviour. Drives most read traffic from the web client.',
    ['PostgreSQL (students DB)', 'institution (academic periods)', 'audit (write events)']],
  ['staff', 'Staff Service', 'Domain Engineering', '#proctira-domain', 3004,
    'Tracks staff profiles, assignments, leave, and qualifications. Used during scheduling, payroll exports, and timetabling.',
    ['PostgreSQL (staff DB)', 'institution (positions, units)', 'audit (write events)']],
  ['assessment', 'Assessment Service', 'Domain Engineering', '#proctira-domain', 3005,
    'Owns assessment definitions, results, and report cards. Heavy bursts at end-of-term as teachers submit grades.',
    ['PostgreSQL (assessment DB)', 'student (enrolments)', 'report (scheduling export jobs)']],
  ['attendance', 'Attendance Service', 'Domain Engineering', '#proctira-domain', 3006,
    'Records daily and per-period attendance, absence reasons, and bulk corrections. Strong write traffic in the morning window.',
    ['PostgreSQL (attendance DB)', 'student', 'notification (parent absence alerts)']],
  ['examination', 'Examination Service', 'Domain Engineering', '#proctira-domain', 3007,
    'Schedules examinations, manages candidate lists, and records exam-level results. Time-critical during national exam windows.',
    ['PostgreSQL (examination DB)', 'student', 'report']],
  ['scholarship', 'Scholarship Service', 'Domain Engineering', '#proctira-domain', 3008,
    'Manages scholarship programmes, applications, and disbursement records.',
    ['PostgreSQL (scholarship DB)', 'student', 'billing (disbursements)']],
  ['health', 'Health Service', 'Domain Engineering', '#proctira-domain', 3009,
    'Tracks student health records, immunisations, screenings, and incidents. Sensitive PII; access strictly RBAC-controlled.',
    ['PostgreSQL (health DB)', 'student', 'audit']],
  ['workflow', 'Workflow Service', 'Platform Engineering', '#proctira-platform', 3011,
    'Hosts BPMN-style workflows, approvals, and state transitions used by other services (e.g. enrolment approvals, transfer approvals).',
    ['PostgreSQL (workflow DB)', 'RabbitMQ (task dispatch)', 'notification']],
  ['notification', 'Notification Service', 'Platform Engineering', '#proctira-platform', 3012,
    'Fan-out service for email, SMS, push, and in-app notifications. Subscribes to events on Kafka and dispatches to providers.',
    ['Kafka (event ingest)', 'Redis (dedupe / templating cache)', 'external SMTP/SMS providers']],
  ['audit', 'Audit Service', 'Security Engineering', '#proctira-security', 3013,
    'Append-only store for audit events emitted by every other service. Source of truth for compliance evidence and forensics.',
    ['PostgreSQL (audit DB, append-only)', 'Kafka (event ingest)']],
  ['custom-field', 'Custom Field Service', 'Domain Engineering', '#proctira-domain', 3014,
    'Lets tenants define and validate custom fields on core entities (student, staff, institution).',
    ['PostgreSQL (custom-field DB)', 'tenant']],
  ['survey', 'Survey Service', 'Domain Engineering', '#proctira-domain', 3015,
    'Authoring and response collection for institutional and student-level surveys.',
    ['PostgreSQL (survey DB)', 'notification']],
  ['report', 'Report Service', 'Platform Engineering', '#proctira-platform', 3016,
    'Compiles tabular and narrative reports across the platform; enqueues long-running jobs to data-warehouse where needed.',
    ['data-warehouse', 'object storage (PDF / CSV exports)', 'RabbitMQ']],
  ['transport', 'Transport Service', 'Domain Engineering', '#proctira-domain', 3017,
    'Manages bus routes, vehicle assignments, and student route memberships.',
    ['PostgreSQL (transport DB)', 'institution']],
  ['etl', 'ETL Service', 'Data Platform', '#proctira-data', 3010,
    'Runs scheduled extract / transform / load pipelines from operational stores into the data warehouse. Long-running, retryable jobs.',
    ['PostgreSQL (operational stores, read-only)', 'data-warehouse', 'object storage (intermediate files)']],
  ['data-warehouse', 'Data Warehouse', 'Data Platform', '#proctira-data', 3018,
    'Analytical store. Hosts dimensional and aggregate models populated by etl. Read by report and admin-console for analytics.',
    ['columnar store (e.g. ClickHouse / Postgres)', 'object storage']],
  ['registration', 'Registration Service', 'Platform Engineering', '#proctira-platform', 3019,
    'Drives the public registration / application flow before a candidate becomes a student.',
    ['PostgreSQL (registration DB)', 'student (handover)', 'notification']],
  ['plugin', 'Plugin Service', 'Platform Engineering', '#proctira-platform', 3020,
    'Hosts the in-platform plugin runtime: install, version, sandbox, and execute tenant-specific plugins.',
    ['PostgreSQL (plugin metadata)', 'object storage (plugin bundles)', 'sandbox runner']],
  ['theme', 'Theme Service', 'Platform Engineering', '#proctira-platform', 3021,
    'Stores per-tenant branding, theme tokens, and asset overrides served to web/admin clients.',
    ['PostgreSQL (theme DB)', 'object storage (assets)']],
  ['billing', 'Billing Service', 'Platform Engineering', '#proctira-platform', 3022,
    'Tracks plans, entitlements, invoices, and usage metering. Integrates with payment processors.',
    ['PostgreSQL (billing DB)', 'tenant', 'external payment gateway']],
  ['policy', 'Policy Service', 'Security Engineering', '#proctira-security', 3023,
    'Stores authorization policies and per-tenant policy bindings consumed by the auth gateway.',
    ['PostgreSQL (policy DB)', 'auth']],
  ['tenant', 'Tenant Service', 'Platform Engineering', '#proctira-platform', 3024,
    'Resolves tenant identity from subdomain or header, manages tenant lifecycle, usage counters, and quota enforcement.',
    ['PostgreSQL (tenant DB)', 'Redis (resolution cache)']],
  ['install', 'Install Service', 'Platform Engineering', '#proctira-platform', 3025,
    'Bootstraps a new deployment: writes initial config, migrates schemas, creates the first admin tenant.',
    ['PostgreSQL (admin / migrations)', 'secrets store']],
  ['developer-portal', 'Developer Portal', 'Platform Engineering', '#proctira-platform', 3026,
    'Public-facing API documentation, sandbox keys, and SDK downloads for integrators.',
    ['object storage (docs)', 'auth (sandbox tokens)']],
  ['web', 'Web App', 'Frontend Engineering', '#proctira-frontend', 3030,
    'Primary web client used by school staff. Server-side rendered Next.js, calls the API gateway.',
    ['api-gateway']],
  ['registration-portal', 'Registration Portal', 'Frontend Engineering', '#proctira-frontend', 3031,
    'Public registration UI used by guardians/applicants. Stateless front end; authenticates via short-lived tokens.',
    ['api-gateway', 'registration']],
  ['public-website', 'Public Website', 'Frontend Engineering', '#proctira-frontend', 3032,
    'Marketing / landing pages and tenant-branded public site. Mostly static with edge caching.',
    ['CDN', 'theme (branding)']],
  ['admin-console', 'Admin Console', 'Platform Operations', '#proctira-ops', 3033,
    'Internal operator UI for tenant management, plugin lifecycle, and audit review.',
    ['api-gateway', 'tenant', 'audit', 'billing']],
];

const BACKEND_MAP = {
  'api-gateway': '../apps/api-gateway',
  web: '../apps/web',
  'registration-portal': '../apps/registration-portal',
  'public-website': '../apps/public-website',
  'admin-console': '../apps/admin-console',
};

function render({ slug, display, ownerTeam, ownerChannel, port, paragraph, deps }) {
  const src = BACKEND_MAP[slug] ?? slug;
  const depsList = deps.map((d) => `- ${d}`).join('\n');
  return `# ${display} Runbook

## Overview

${paragraph}

| Field          | Value                                            |
| -------------- | ------------------------------------------------ |
| Service slug   | \`${slug}\`                                         |
| Default port   | \`${port}\`                                         |
| Owner team     | ${ownerTeam}                                     |
| Slack channel  | ${ownerChannel}                                  |
| On-call group  | \`${slug}-oncall\`                                  |
| Source         | \`packages/backend/${src}\` (or \`apps/${slug}\` if applicable) |

## Dependencies

Upstream services and infrastructure required for \`${slug}\` to operate:

${depsList}

If any of the above are unhealthy, expect cascading failures here. Check
their dashboards before declaring \`${slug}\` itself the root cause.

## Service Level Objectives

| SLI            | SLO                       | Window  | Alert rule                  |
| -------------- | ------------------------- | ------- | --------------------------- |
| Availability   | 99.9% successful (non-5xx) | 30d     | \`ServiceErrorRateHigh\`, \`ServiceDown\` |
| Latency (P95)  | < 500 ms                   | 5m      | \`ServiceP95LatencyHigh\`     |
| Latency (P99)  | < 2 s                      | 5m      | \`ServiceP99LatencyHigh\`     |
| Error budget   | burn rate < 14.4x          | 1h / 5m | \`ErrorBudgetBurnFast\`       |
| CPU saturation | < 85% of one core          | 5m      | \`ProcessCPUHigh\`            |
| Memory         | < 90% of heap              | 5m      | \`ProcessMemoryHigh\`         |

## Common Failure Modes

### 1. Elevated 5xx error rate
- **Symptom**: \`ServiceErrorRateHigh\` / \`ServiceErrorRateCritical\` firing.
- **Likely cause**: downstream dependency outage, recent deploy, or DB
  connection exhaustion.
- **Remediation**:
  1. Check the *Service Overview* Grafana dashboard for the spike onset.
  2. Correlate with recent deploys (\`git log --since=1h\`).
  3. Inspect logs in Loki / pino with \`service="${slug}"\`.
  4. If a recent deploy is implicated, follow **Rollback** below.

### 2. Latency regression
- **Symptom**: \`ServiceP95LatencyHigh\` firing while error rate is normal.
- **Likely cause**: slow dependency (DB, queue), saturated event loop,
  or noisy neighbour tenant.
- **Remediation**:
  1. Use the *Tenant Overview* dashboard to identify a hot tenant.
  2. Check the *Dependencies* dashboard for DB / queue latency.
  3. Consider scaling out additional replicas while you investigate.

### 3. Service down (scrape failing)
- **Symptom**: \`ServiceDown\` firing; \`up{service="${slug}"}\` is 0.
- **Likely cause**: process crashed, network partition, or container OOM.
- **Remediation**:
  1. \`kubectl get pods -l app=${slug}\` (or \`docker compose ps\`).
  2. Inspect the most recent crash log.
  3. If OOM, follow **Memory saturation** below.
  4. If hard-down, restart the deployment and capture a heap dump first
     when feasible.

### 4. Memory saturation / OOM
- **Symptom**: \`ProcessMemoryHigh\` then \`ServiceDown\`.
- **Likely cause**: leak after a recent change, oversized payloads, or
  unbounded cache growth.
- **Remediation**:
  1. Capture a heap snapshot (\`kill -SIGUSR2 <pid>\` for Node).
  2. Restart to recover; file a follow-up incident.
  3. Roll back if a recent deploy is implicated.

### 5. CPU / event-loop saturation
- **Symptom**: \`ProcessCPUHigh\` or \`EventLoopLagHigh\`.
- **Likely cause**: hot-loop in code, sync I/O, large synchronous JSON
  parse / serialize.
- **Remediation**:
  1. Capture a CPU profile (\`node --prof\` or \`clinic flame\`).
  2. Throttle the offending tenant via the api-gateway rate limit override.
  3. Scale horizontally while diagnosing.

## Rollback Procedure

1. Identify the last known good image tag from the deployment history
   (Argo CD / \`kubectl rollout history deployment/${slug}\`).
2. \`kubectl rollout undo deployment/${slug}\` (or pin the image tag in the
   compose file and \`docker compose up -d ${slug}\`).
3. Confirm \`up{service="${slug}"} == 1\` and that error rate has dropped
   in Grafana.
4. Open a post-incident ticket in the \`${slug}\` repo with the offending
   commit range.

## Escalation

| Step | Action                                                   | Time-to-page |
| ---- | -------------------------------------------------------- | ------------ |
| 1    | Primary on-call (\`${slug}-oncall\` PagerDuty)              | Immediately  |
| 2    | Secondary on-call                                        | +15 min      |
| 3    | Team lead, ${ownerTeam}                                  | +30 min      |
| 4    | Engineering manager + Incident Commander                 | +60 min      |
| 5    | CTO bridge (P1 incidents only)                           | +90 min      |

Coordination happens in ${ownerChannel}. Use \`/incident declare\`
in Slack to spin up a dedicated incident channel for P1/P2 events.

## References

- Dashboards
  - [Service Overview](https://grafana.proctira.org/d/proctira-service-overview)
  - [SLO Tracking](https://grafana.proctira.org/d/proctira-slo-tracking)
  - [Tenant Overview](https://grafana.proctira.org/d/proctira-tenant-overview)
  - [Dependencies](https://grafana.proctira.org/d/proctira-dependencies)
- Alert definitions: \`infra/observability/alerts/\`
- Source: \`packages/backend/${src}/\`
- Charter: Section 38 (SLO, SLI, Service Operations)
`;
}

await mkdir(OUT_DIR, { recursive: true });
for (const [slug, display, ownerTeam, ownerChannel, port, paragraph, deps] of SERVICES) {
  const body = render({ slug, display, ownerTeam, ownerChannel, port, paragraph, deps });
  const path = resolve(OUT_DIR, `${slug}.md`);
  await writeFile(path, body, 'utf8');
}
console.log(`Wrote ${SERVICES.length} runbooks to ${OUT_DIR}`);
