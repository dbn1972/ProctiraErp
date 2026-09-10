# ProctiraERP Service Runbooks

Each runbook documents how to operate a single service in production:
its dependencies, SLOs, common failure modes, rollback procedure, and
escalation path. They are linked from every alert rule's `runbook_url`
annotation in `infra/observability/alerts/*.yml`.

## Conventions

- **Owner**: name of the team (Slack handle) responsible for the service.
- **SLOs**: target availability and latency. See
  `infra/observability/alerts/` for the alert rules that enforce them.
- **Failure modes**: ordered most-likely first. Each entry includes the
  symptom you'll see in dashboards/alerts and the remediation.
- **Rollback**: the canonical way to revert to the last good build.
- **Escalation**: who to page if first-line response cannot resolve.

## Index

- [database-migration-rollback](./database-migration-rollback.md) — both schema tracks, forward reverts, point-in-time restore

- [api-gateway](./api-gateway.md)
- [auth](./auth.md)
- [institution](./institution.md)
- [student](./student.md)
- [staff](./staff.md)
- [assessment](./assessment.md)
- [attendance](./attendance.md)
- [examination](./examination.md)
- [scholarship](./scholarship.md)
- [health](./health.md)
- [workflow](./workflow.md)
- [notification](./notification.md)
- [audit](./audit.md)
- [custom-field](./custom-field.md)
- [survey](./survey.md)
- [report](./report.md)
- [transport](./transport.md)
- [etl](./etl.md)
- [data-warehouse](./data-warehouse.md)
- [registration](./registration.md)
- [plugin](./plugin.md)
- [theme](./theme.md)
- [billing](./billing.md)
- [policy](./policy.md)
- [tenant](./tenant.md)
- [install](./install.md)
- [developer-portal](./developer-portal.md)
- [web](./web.md)
- [registration-portal](./registration-portal.md)
- [public-website](./public-website.md)
- [admin-console](./admin-console.md)
