# Production readiness — current state (2026-09-04)

Honest status after the P18–P26 production hardening pass. This supersedes aspirational checklists that claimed readiness without evidence.

## Verdict

**Core school ops (P3–P16): production-capable** when `DATABASE_URL` is set, gateway secrets are non-default, and EC3 (or equivalent) is migrated.

**Expansion domains (P18–P26): operational MVPs** — finance fee cycle, timetable clash detection, and payroll run generation are implemented and tested; remaining expansion UIs are list/ops desks, not full redesign depth.

**Not yet world-class end-to-end:** live Twilio/FCM secrets, Flutter device E2E, statutory payroll filings, bank reconciliation, SCORM LMS, and full RBAC matrix on every mutation.

## Gateway

| Control | Status |
|---------|--------|
| Fail-closed JWT secret in production | **Done** (`assertProductionConfig`) |
| Require `DATABASE_URL` in production | **Done** |
| `/health/live` always up | **Done** |
| `/health/ready` probes Postgres (+ Redis when configured) → 503 | **Done** |
| Redis rate-limit when `REDIS_URL` set; in-memory fallback | **Done** |
| Global JWT on domain routes | **Done** |
| Per-route RBAC for fee/payroll clerks | **Partial** — JWT required; fine-grained roles still coarse |

## Domain depth

| Domain | Production capability |
|--------|----------------------|
| Finance | Assign fees → generate invoices → record payment updates invoice status + receipt numbers |
| Timetable | Slot create/update rejects staff/class/room clashes with HTTP 409 |
| Payroll | `POST .../runs/generate` expands staff + structure into payslips + run totals |
| Library…LMS | CRUD + web list desks; deepen next if prioritized |

## Ops checklist before go-live

1. Set strong `JWT_SECRET` / Keycloak issuer; never ship defaults.
2. Set `DATABASE_URL` (+ `_HOST` variants for EC3 outside Compose).
3. Set `TWILIO_*` and FCM secret files for live SMS/push.
4. Run `prisma migrate deploy` (includes `20260904_finance_fee_cycle`).
5. Confirm `/health/ready` returns 200 against real Postgres.
6. Smoke: fee assign → invoice generate → payment; timetable clash 409; payroll generate.
7. Backup/restore drill per `docs/BACKUP_RESTORE.md`.

## Env additions (see `.env.example`)

- `DATABASE_URL_HOST`, `REDIS_URL_HOST`
- `METRICS_ENABLED`, `TRACING_ENABLED`, `AUDIT_ENABLED`
- Production secrets note for JWT

## Document honesty

Scope table marks P18–P26 as **MVP FULL (ops cycle)** for finance/timetable/payroll and **CRUD+web** for the rest — not “complete ERP parity with legacy vendors.”
