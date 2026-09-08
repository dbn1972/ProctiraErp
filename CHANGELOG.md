# Changelog

All notable changes to ProctiraERP are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/). Gap ids (`G-xxx`) reference
`docs/audits/ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md`.

Release discipline: every PR that changes behaviour adds a line under
**Unreleased**; the release workflow (`release.yml`) tags the image set and the
section is renamed to the version + date.

## [Unreleased]

### Added

- PR-level live E2E gate: `e2e-backend-ready.yml` runs on every pull request
  against Postgres + api-gateway with `E2E_REQUIRE_LIVE=1`, strict tenant FKs
  and seeded E2E tenants (G-706).
- Hardened `proctira-service` Helm chart: non-root/read-only pods, dedicated
  ServiceAccount, HPA, PodDisruptionBudget, NetworkPolicy, ExternalSecret
  opt-in, per-service probe paths; release image matrix now covers every
  Next.js app (G-724).
- Governance: `CODEOWNERS`, Dependabot (npm, GitHub Actions, Docker, pub),
  this changelog, and the database migration & rollback runbook (G-726).
- Scheduled disaster recovery: `pg-backup` and `phi-retention` CronJobs on a
  shared PVC, `dr-tools` image, weekly `restore-drill.yml` with row-parity
  verification (G-707).
- Supply chain: hard advisory gate with expiring waivers, CycloneDX 1.5 SBOM,
  keyless cosign signing of the gateway image (G-708).
- Real workflow engine mounted under `/workflow-engine` on Postgres (G-715).
- Real PDF generation for report cards, transcripts and exam documents via
  `@proctira/pdf-lite` (G-716).
- Postgres persistence for HR appraisal/training, admissions CRM, report-card
  templates, audit, billing, tenant lifecycle, invites, OTP, Keycloak identity
  and platform-admin stores (G-704, G-717).
- Double-entry fee ledger and row-locked leave balances (G-718).
- Web CSRF double-submit + origin gate and transport-aware `Secure` cookies
  (G-719).

### Changed

- Rate-limit buckets key on the verified JWT tenant + subject; `x-tenant-id`
  never selects a bucket or plan tier (G-731).
- Idempotency falls back to a bounded in-memory store with a boot warning when
  `REDIS_URL` is unset (G-731).
- Parent, guardian and student roles may perform portal self-service writes;
  the parent-portal plugin binds every row to the JWT subject (G-706).
- RBAC is default-deny for unmapped API prefixes and checks read permissions on
  GET (G-702, G-712).

### Fixed

- Postgres notification preferences/devices store now binds `app.tenant_id`,
  fixing RLS rejections under FORCE ROW LEVEL SECURITY (G-706).
- Communication live-audience counts are tenant-scoped instead of silently
  returning zero under RLS (G-706).
- `pg-backup.sh` refuses roles without `BYPASSRLS`, which previously produced
  empty dumps under FORCE RLS (G-707).
- Timetable bell-schedule soft delete now retires its periods (G-732).

### Security

- JWT verification fails closed in production when `JWT_SECRET` is missing
  (G-703).
- PHI encryption key is required in production; counselling and profile PHI
  columns are encrypted at rest (G-711).
- FORCE ROW LEVEL SECURITY on `attendance_audit`, `tenants`,
  `tenant_theme_versions`, `tenant_theme_drafts`; tenant GUC set via bound
  parameters (G-720, G-732).
- OTP digits redacted from console SMS logs; `MFA_EXPOSE_OTP=true` refused in
  production (G-731).
- Demo seeds gated behind `APPLY_SEEDS=1` / `SEED_DEMO_DATA` (G-705).

## [0.1.0] - 2026-06-07

### Added

- Initial ProctiraERP monorepo baseline: api-gateway, web, registration portal,
  admin console, developer portal, install wizard, public website, Flutter
  mobile shell, backend domain packages and shared libraries.
