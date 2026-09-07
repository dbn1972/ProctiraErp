---
name: enterprise-module-development
description: >-
  Build world-class ProctiraERP redesign modules (domain, SQL, API, UI, security)
  to an enterprise 10/10 bar. Use when implementing or closing product gaps
  (SIS schedule, gradebook, transcripts, board exports, timetable, fees, etc.),
  when the user asks for a development plan or feature build, or before claiming
  a module is product-complete. Pair with enterprise-module-production-ready
  for testing after implementation.
---

# Enterprise Module Development (10/10 build bar)

This skill is the **Definition of Build** for any redesign or greenfield domain module. It complements `.cursor/skills/enterprise-module-production-ready/SKILL.md` (Definition of Test). **Build first → test second.** Do not claim 10/10 until both skills’ exit criteria pass (or dated waivers exist).

## When this skill applies

Trigger on: implement, build, develop, close gap, feature, SIS, schedule, gradebook, transcript, report card, GPA, timetable, bell schedule, substitution, room booking, board export, CBSE, ICSE, marksheet, master schedule, product parity — or when `.cursor/hooks/state/enterprise-dev-session.json` is active.

## Honest product vs test distinction

| Claim                         | Requires                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Screen audited 9.5**        | Production-ready **test** skill evidence                                                                         |
| **World-class product 10/10** | Full **domain capability** (this skill) **plus** test skill, with live IdP / device-farm only as dated externals |

Peers (PowerSchool / Infinite Campus / Ellucian-class) treat schedule, gradebook, transcripts, and board packs as **core SIS**, not optional extras.

## Required workflow (do not skip)

Copy:

`docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`

→ `docs/audits/DEV_<MODULE>_<CAPABILITY>.md`

Work pillars **in order**. Mark checkboxes only with paths/SHAs/artifacts.

### 0. Product contract & scope lock

1. Write the **capability statement** (one paragraph): what a registrar / teacher / student / board officer can do when done.
2. List **peer parity targets** (what “10/10 like others” means for this slice).
3. List **non-goals** for this slice (explicit).
4. Map nav labels → routes → APIs → tables.
5. Define **roles** (RBAC) and **tenant boundaries**.
6. Define **board variance** (CBSE / ICSE / state) if compliance-related.

### 1. Domain model (data plane)

Prefer **raw SQL** under `db/sql/` for certification-grade schema (same rule as live multi-board onboarding — **do not use Prisma for apply/seed/verify** of cert paths).

1. Add versioned SQL migration(s) with FKs, unique constraints, indexes.
2. Document entities, state machines, and invariants in the DEV audit.
3. Seed fixtures for **3 boards × ≥2 schools** where board rules differ.
4. Property/unit tests for pure domain rules (GPA, credit, clash detection).

### 2. API / application services

1. Gateway or backend package endpoints with tenant middleware.
2. Input validation (zod or equivalent); idempotent writes where retries matter.
3. AuthZ: role checks + cross-tenant deny tests.
4. Error model: 400 validation, 403 forbidden, 409 conflict (e.g. room clash), 422 board-rule fail.
5. No silent stub success when live DB is configured — honesty banner only if intentionally demo.

### 3. UI (redesign system)

1. Routes under redesign shell; match existing Academics patterns.
2. Empty / loading / error / success states.
3. Forms: client validation + server error mapping.
4. Board-aware labels/fields (do not hardcode one board’s marksheet as universal).
5. Multidevice-friendly layouts (no hover-only critical actions).

### 4. Cross-module integration

| Capability                 | Must integrate with                                      |
| -------------------------- | -------------------------------------------------------- |
| Master schedule / sections | Institutions, academic periods, staff assignments, rooms |
| Attendance                 | Sections / periods from timetable                        |
| Gradebook                  | Assessments, enrollments, credit rules                   |
| Transcripts / report cards | Gradebook finals, board templates                        |
| Board exports              | Transcripts + exam results + school codes                |
| Substitutions              | Timetable slots + staff                                  |

### 5. Observability & operability

1. Structured logs on write paths (tenantId, actorId, entity ids).
2. Audit events for grade changes, transcript issuance, schedule publishes.
3. Export job status (queued / running / failed / download) — no fire-and-forget without status.

### 6. Security & compliance

1. Tenant isolation tests for every new read/write.
2. RBAC matrix documented (who can publish schedule, lock grades, issue transcript, export board pack).
3. PII minimization on exports; download auth + short-lived URLs where files are generated.
4. Board data: immutable issued transcripts (append-only or versioned).

### 7. Hand-off to enterprise test skill

Before claiming merge-ready / 10/10:

1. Activate / follow `enterprise-module-production-ready`.
2. Fill `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md` for the new screens.
3. Ungated smokes + gated live write E2E (`E2E_BACKEND_READY=1`).
4. Desktop + tablet + mobile captures.
5. Tip CI green.

## Exit criteria — capability 10/10

| Gate             | Pass                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| Product contract | Peer parity items for this slice implemented or explicitly waived with owner/date |
| Schema           | SQL applied on live Postgres; seeds for multi-board                               |
| API              | Live write/read E2E against seeded tenant                                         |
| UI               | All inventory screens load + critical writes work                                 |
| Rules engine     | Automated tests for clashes / GPA / board validation                              |
| Exports          | At least one real file artifact per supported board (CBSE, ICSE, one state)       |
| Security         | Tenant deny + RBAC deny evidence                                                  |
| Test skill       | Production-ready checklist complete                                               |
| CI               | Tip green                                                                         |

## Anti-patterns (fail the build bar)

- UI-only schedules with “demo-ack” creates and no persistence
- Single-board hardcoding labeled as “multi-board”
- GPA/transcripts as static PDF upload without calculation/rules
- Claiming device-farm or live IdP evidence that was not run
- Using Prisma for the live multi-board certification apply/seed/verify path
- Marking 10/10 when only widget goldens exist for mobile-critical flows

## SIS gap epic — default build order

When closing core SIS gaps vs world-class peers, implement in this order (dependencies flow downward):

1. **Timetable / calendar** — bell schedules, period grid, calendar sync hooks, substitution assignments
2. **Master schedule / rostering** — sections, room assignment, conflict engine
3. **Gradebook & transcripts** — standards/marks entry, credit rules, GPA, report cards, official transcripts
4. **Multi-board compliance packs** — CBSE / ICSE / state marksheet + exam export formats

Plan of record: `docs/plans/SIS_WORLD_CLASS_10_GAP_CLOSURE.md`.

## Reference paths

| Asset                                          | Path                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Dev checklist template                         | `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`   |
| Product / IA skill                             | `.cursor/skills/enterprise-product-ia/SKILL.md`              |
| Test skill                                     | `.cursor/skills/enterprise-module-production-ready/SKILL.md` |
| UX / a11y / security / mobile / data / release | see `docs/plans/ENTERPRISE_SKILLS_MAP.md`                    |
| Test checklist                                 | `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`  |
| Core onboarding SQL                            | `db/sql/001_core_onboarding_schema.sql`                      |
| Scoreboard                                     | `docs/audits/SCREEN_BY_SCREEN_SCOREBOARD.md`                 |
| Gap closure plan                               | `docs/plans/SIS_WORLD_CLASS_10_GAP_CLOSURE.md`               |
