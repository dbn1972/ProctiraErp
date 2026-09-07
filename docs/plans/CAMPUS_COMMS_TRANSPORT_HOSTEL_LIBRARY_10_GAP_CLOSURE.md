# Campus services & communication — world-class 10/10 gap closure plan

**Status:** implementation in progress (WS1–WS5 foundations landed; WS6 enterprise packs pending)  
**Updated (UTC):** 2026-09-07  
**Branch context:** `cursor/enterprise-score-uplift-56c3` (or successor `cursor/*-56c3` feature branches)  
**Skills (mandatory pairing):**

- **Build** → `.cursor/skills/enterprise-module-development/SKILL.md`
- **Test** → `.cursor/skills/enterprise-module-production-ready/SKILL.md`

This plan closes the **product + inventory** gaps called out in the enterprise session:

> Communication (SMS/email/push campaigns, emergency alerts) · Notifications prefs (mobile thin) · Comms center + emergency blast · Transport / hostel / library — _common in regional ERPs · not in nav inventory · entire modules missing_

Do **not** invent calendar durations. Sequence by **dependency**, not clock time. Claim **10/10** only when **both** skills’ exit criteria pass (or dated waivers with owner + risk).

---

## Outcome definition (program 10/10 for these slices)

When this epic is done, a multi-board tenant can:

1. Run a **Comms Center**: audience-targeted **email / SMS / push / in-app** campaigns with delivery reports and audit.
2. Issue an **Emergency blast** that bypasses quiet hours / DND with dual-confirm + immutable audit trail.
3. Manage **notification preferences** (web + mobile) backed by live API (not client-only stubs).
4. Operate **Transport**: routes, stops, vehicles, driver + student assignments with overlap detection.
5. Operate **Hostel**: blocks/rooms/beds, occupancy assignment, leave/visitor logs.
6. Operate **Library**: catalog, circulation (checkout/return/renew), overdues / clearance hooks into student transfer.

Each module must:

1. Appear in **redesign gallery + Next sidebar + `en.json` nav** (fix “not in nav inventory”).
2. Ship **raw SQL** schema (cert path — no Prisma for apply/seed/verify).
3. Mount on **api-gateway** `DOMAIN_REGISTRARS`.
4. Pass a filled `DEV_*.md` **and** production-ready test audit with evidence pack.

External caps that still apply program-wide unless closed: **live IdP E2E**, **Android device-farm PNGs**, provider sandbox credentials (Twilio/FCM/SMTP) beyond env stubs.

---

## Current baseline (honest)

| Domain                        | Backend                                                    | Gateway mount                                         | Web App Router                                      | Redesign HTML                                                | Gallery inventory                                      | Mobile                      | Gap to peer 10/10                                                          |
| ----------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ | --------------------------- | -------------------------------------------------------------------------- |
| **Notifications**             | Strong in-memory package (`packages/backend/notification`) | Deployable standalone; **not** in `domain-plugins.ts` | Settings prefs only (`/app/settings/notifications`) | `notifications-center.html`, `admin-notification-rules.html` | Web **not** in gallery list; mobile inbox/prefs listed | Inbox + FCM + prefs screens | Mount gateway; prefs/devices APIs; web inbox + rules; SMS channel; live PG |
| **Communication / campaigns** | **None**                                                   | Marketplace/plugin stub category only                 | **None**                                            | **None**                                                     | **Missing**                                            | **None**                    | Entire module greenfield                                                   |
| **Transport**                 | Strong in-memory (`packages/backend/transport`)            | **Not** mounted                                       | **None**                                            | 5 screens under Services                                     | HTML exists but **not** in 124-screen gallery          | **None**                    | Mount + SQL + App Router + nav + E2E                                       |
| **Hostel**                    | **None**                                                   | —                                                     | —                                                   | Transfer/custom-field mentions only                          | **Missing**                                            | —                           | Entire module greenfield                                                   |
| **Library**                   | **None**                                                   | —                                                     | —                                                   | Facility + transfer clearance only                           | **Missing**                                            | —                           | Entire module greenfield                                                   |

Reference peers for parity language: Fedena / openSIS / CampusVue-class regional ERPs (comms + transport + hostel + library as first-class Services), plus PowerSchool/Infinite Campus for emergency parent blast patterns.

---

## Workstreams & dependency order

```text
WS0  Inventory + product contracts (all modules)
  │
  ├─► WS1  Notifications foundation (mount + SQL + prefs/devices + SMS channel)
  │         └─► WS2  Communication / Comms Center + Emergency blast
  │
  ├─► WS3  Transport (mount existing package + SQL + web screens)
  │
  ├─► WS4  Hostel (greenfield)
  │
  └─► WS5  Library (greenfield; integrate transfer clearance)
            │
            └─► WS6  Enterprise test packs (per module) + tip CI green
```

**Why this order**

- Campaigns and emergency blast **consume** notification delivery; prefs/devices must be real APIs first.
- Transport already has domain code — fastest path to a Services nav win.
- Hostel / Library are independent after shared student/institution FKs; Library should hook student-transfer checklist last.

---

## WS0 — Scope lock & inventory (all modules)

### Deliverables

| Artifact                    | Path                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This plan                   | `docs/plans/CAMPUS_COMMS_TRANSPORT_HOSTEL_LIBRARY_10_GAP_CLOSURE.md`                                                                                                       |
| Dev audits (one per module) | `docs/audits/DEV_COMMUNICATION_CAMPAIGNS.md`, `DEV_NOTIFICATIONS_INBOX_PREFS.md`, `DEV_TRANSPORT_ROUTES_FLEET.md`, `DEV_HOSTEL_OCCUPANCY.md`, `DEV_LIBRARY_CIRCULATION.md` |
| Nav inventory updates       | `redesign/index.html`, `redesign/shared/app.js`, `apps/web/src/components/layout/sidebar.tsx`, `apps/web/messages/en.json`                                                 |
| Dev session hook            | `.cursor/hooks/state/enterprise-dev-session.json` (modules list)                                                                                                           |

### Product contracts (capability statements)

| Module        | One-paragraph capability                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notifications | Staff/students receive multi-channel notices; users manage channel prefs; admins configure rules/templates; devices register for push.                      |
| Communication | Comms officers create scheduled/immediate campaigns to segments (class, route, hostel, custom); emergency blast reaches all guardians with confirm + audit. |
| Transport     | Transport officer maintains routes/stops/vehicles and assigns drivers/students without overlapping vehicle or student conflicts.                            |
| Hostel        | Warden manages hostels → blocks → rooms → beds, assigns residents, records leave/visitors.                                                                  |
| Library       | Librarian catalogs holdings, circulates items to patrons, tracks overdues; transfer flow can require “library clear.”                                       |

### Explicit non-goals (v1)

| Item                                          | Rationale                                              |
| --------------------------------------------- | ------------------------------------------------------ |
| Full marketing automation / drip journeys     | Out of school-ERP scope                                |
| Real-time GPS bus tracking map                | Optional phase-2; v1 = static routes + assignments     |
| Mess billing / hostel fee ledger              | Defer to Fees domain                                   |
| Full OPAC public portal                       | Staff circulation + catalog first                      |
| Guaranteed SMS delivery without provider keys | Sandbox adapter + honesty banner until secrets present |

---

## WS1 — Notifications foundation

**Build skill checklist:** `docs/audits/DEV_NOTIFICATIONS_INBOX_PREFS.md`  
**Test skill checklist:** `docs/audits/NOTIFICATIONS_INBOX_PREFS_RULES.md`

### Screen inventory

| Nav label                   | Route                           | Roles             | PII |
| --------------------------- | ------------------------------- | ----------------- | --- |
| Notifications · inbox       | `/notifications`                | all authenticated | Yes |
| Notifications · detail      | `/notifications/[id]`           | owner             | Yes |
| Admin · notification rules  | `/admin/notification-rules`     | tenant admin      | Low |
| Admin · templates           | `/admin/notification-templates` | tenant admin      | Low |
| Settings · prefs (existing) | `/app/settings/notifications`   | self              | Yes |
| Mobile · inbox / prefs      | Flutter routes (existing)       | self              | Yes |

### Build steps

1. **SQL** `db/sql/010_notifications_schema.sql` — messages, deliveries, preferences, devices, rules, templates (tenant-scoped).
2. Replace in-memory store with `PgNotificationStore` (mirror health counselling pattern — raw `pg`).
3. Implement missing APIs: `GET/PATCH /notifications/preferences`, `POST/DELETE /notifications/devices`.
4. Add **SMS** channel to schemas + provider adapter interface (Twilio/MessageBird stub).
5. Mount `@proctira/backend-notification` in `apps/api-gateway/src/domain-plugins.ts`.
6. Wire web App Router inbox + admin rules from redesign HTML.
7. Unit/property tests: preference mute, emergency-bypass rule, tenant isolation.

### Test exit (production-ready)

- Ungated smoke: `/notifications` → login; gated live send + mark-read.
- Prefs write path E2E.
- Multidevice PNG pack `/opt/cursor/artifacts/notifications-audit/`.
- Mobile thin prefs: Vitest/Flutter analyze + one integration_test or dated waiver.

---

## WS2 — Communication / Comms Center + Emergency blast

**Depends on:** WS1 delivery pipeline.  
**Build:** `docs/audits/DEV_COMMUNICATION_CAMPAIGNS.md`  
**Test:** `docs/audits/COMMUNICATION_CAMPAIGNS_EMERGENCY.md`

### Screen inventory

| Nav label                   | Route                           | Roles                      | PII  |
| --------------------------- | ------------------------------- | -------------------------- | ---- |
| Communication · center      | `/communication`                | comms officer+             | Yes  |
| Campaigns · list            | `/communication/campaigns`      | comms officer+             | Yes  |
| Campaigns · new             | `/communication/campaigns/new`  | comms officer+             | Yes  |
| Campaigns · detail / report | `/communication/campaigns/[id]` | comms officer+             | Yes  |
| Templates                   | `/communication/templates`      | comms officer+             | Low  |
| Emergency blast             | `/communication/emergency`      | principal / emergency role | High |
| Audit log (blast)           | `/communication/emergency/[id]` | auditor+                   | High |

### Domain model (SQL)

`db/sql/011_communication_schema.sql`:

- `comms_campaigns` (status: draft → scheduled → sending → sent → failed)
- `comms_audiences` / segment rules (institution, grade, route_id, hostel_id, custom SQL-safe filters)
- `comms_deliveries` (links notification delivery ids)
- `comms_emergency_blasts` (dual-confirm actor ids, reason, channel mask, immutable)
- Indexes on `(tenant_id, status)`, `(tenant_id, created_at DESC)`

### Build steps

1. New package `packages/backend/communication` (or extend notification with campaign subdomain — prefer **separate package** for RBAC clarity).
2. Segment resolver using students/enrollments/transport assignments/hostel residents.
3. Emergency flow: two-step confirm UI + server-side `confirmToken`; always audits; respects “bypass DND” flag on notification rules.
4. Gateway mount `/api/v1/communication`.
5. Redesign HTML → App Router; add Services nav entry **Communication**.
6. Seed demo campaign + one emergency drill in multi-board cert tenant.

### Peer parity must-haves

| Peer behavior          | Acceptance                                   |
| ---------------------- | -------------------------------------------- |
| Multi-channel campaign | ≥2 channels in one campaign                  |
| Audience preview count | API returns estimated recipients before send |
| Emergency dual control | Cannot send with single click                |
| Delivery report        | Per-channel success/fail counts              |

---

## WS3 — Transport

**Build:** `docs/audits/DEV_TRANSPORT_ROUTES_FLEET.md`  
**Test:** `docs/audits/TRANSPORT_ROUTES_VEHICLES_ASSIGNMENTS.md`

### Screen inventory (from redesign)

| Nav label                    | Route                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| Transport · overview         | `/transport`                                                           |
| Routes · list / new / detail | `/transport/routes`, `/transport/routes/new`, `/transport/routes/[id]` |
| Vehicles                     | `/transport/vehicles`                                                  |
| Assignments                  | `/transport/assignments`                                               |

### Build steps

1. SQL `db/sql/012_transport_schema.sql` from existing Typebox entities (routes, stops, vehicles, driver_assignments, student_assignments).
2. `PgTransportStore` + keep overlap property tests against SQL.
3. Mount in gateway; flip tenant `features.transport` default for cert tenant.
4. App Router pages wired to actions; empty/error/loading states.
5. Sidebar + gallery inventory registration.
6. Seed: ≥1 route with stops + vehicle + 25 student assignments per cert school (or subset for volume).

### Test exit

- Ungated inventory smoke `e2e/2x-transport-inventory-smoke.spec.ts`.
- Live create route + assign student (negative: double-book vehicle).
- 3-viewport captures `/opt/cursor/artifacts/transport-audit/`.

---

## WS4 — Hostel

**Build:** `docs/audits/DEV_HOSTEL_OCCUPANCY.md`  
**Test:** `docs/audits/HOSTEL_BLOCKS_ROOMS_ASSIGNMENTS.md`

### Screen inventory

| Nav label         | Route                                |
| ----------------- | ------------------------------------ |
| Hostel · list     | `/hostel`                            |
| Hostel · detail   | `/hostel/[id]`                       |
| Rooms / beds      | `/hostel/[id]/rooms`                 |
| Assignments       | `/hostel/assignments`                |
| Leaves / visitors | `/hostel/leaves`, `/hostel/visitors` |

### Domain (SQL sketch)

`db/sql/013_hostel_schema.sql`: hostels → blocks → rooms → beds; `hostel_assignments` (student_id, bed_id, date range); `hostel_leaves`; `hostel_visitors`. Unique: one active bed per student; one student per bed.

### Build + test

Same pillar sequence as Transport. Integrate Communication audiences (`hostel_id` segment) once WS2 lands.

---

## WS5 — Library

**Build:** `docs/audits/DEV_LIBRARY_CIRCULATION.md`  
**Test:** `docs/audits/LIBRARY_CATALOG_CIRCULATION.md`

### Screen inventory

| Nav label          | Route                                   |
| ------------------ | --------------------------------------- |
| Library · catalog  | `/library`                              |
| Item detail        | `/library/items/[id]`                   |
| Circulation desk   | `/library/circulation`                  |
| Patrons / overdues | `/library/patrons`, `/library/overdues` |

### Domain (SQL sketch)

`db/sql/014_library_schema.sql`: `library_items` (ISBN/barcode), `library_copies`, `library_loans` (checkout/due/return), fines optional stub. Hook student transfer checklist “Library clear” via API `GET /library/patrons/:studentId/clearance`.

---

## WS6 — Enterprise test campaign (all modules)

For **each** module after build:

1. Activate enterprise-test session with `modules: ["notifications","communication","transport","hostel","library"]` (or per-PR subsets).
2. Copy `ENTERPRISE_MODULE_TEST_CHECKLIST.md` → module audit.
3. Pillars in order: functionality → e2e → ux → multidevice → security → ci.
4. Extend `a11y-axe`, `dark-mode-parity`, `touch-target-minimum`, `capture-screens.mjs` TARGETS.
5. Tenant isolation gate for every new table.
6. Tip CI green before `pillars.ci=true`.

### Score targets

| Module        | After build + test                                  | Notes                              |
| ------------- | --------------------------------------------------- | ---------------------------------- |
| Notifications | **9.5 → 10** with provider sandbox waiver if needed | Prefs no longer “mobile thin only” |
| Communication | **9.5** (10 if live SMS+email providers proven)     | Emergency blast mandatory for 9.5  |
| Transport     | **9.5 → 10**                                        | Overlap tests already exist        |
| Hostel        | **9.5**                                             | Fees/mess out of scope             |
| Library       | **9.5**                                             | Public OPAC out of scope           |

Program Services rollup moves from Scholarships/Health/Workflows-only to include these five — update `docs/audits/SCREEN_BY_SCREEN_SCOREBOARD.md` and CivitasOne scorecard when each module’s audits close.

---

## RBAC matrix (minimum)

| Role                  | Notif prefs | Inbox | Rules/templates | Campaigns | Emergency | Transport      | Hostel       | Library |
| --------------------- | ----------- | ----- | --------------- | --------- | --------- | -------------- | ------------ | ------- |
| Student / guardian    | self        | self  | —               | —         | —         | read own route | read own bed | patron  |
| Teacher               | self        | self  | —               | —         | —         | —              | —            | limited |
| Comms officer         | self        | yes   | read            | CRUD      | —         | —              | —            | —       |
| Principal / emergency | self        | yes   | —               | read      | **send**  | —              | —            | —       |
| Transport officer     | self        | yes   | —               | —         | —         | CRUD           | —            | —       |
| Warden                | self        | yes   | —               | —         | —         | —              | CRUD         | —       |
| Librarian             | self        | yes   | —               | —         | —         | —              | —            | CRUD    |
| Tenant admin          | yes         | yes   | CRUD            | CRUD      | grant     | grant          | grant        | grant   |

Cross-tenant IDOR tests required on every list/get/write.

---

## Security & compliance extras

| Concern                  | Requirement                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Emergency blast          | Immutable audit (who, when, audience count, channels, confirm tokens); rate-limit; no silent success without delivery jobs |
| SMS/PII                  | Minimize body content in logs; redact phone/email in artifacts                                                             |
| Campaign audience export | Same RBAC as campaign read; no bulk PII download without role                                                              |
| Library fines            | Optional; if present, financial PII handling like scholarships                                                             |
| Hostel visitors          | PII retention policy note in DEV audit                                                                                     |

---

## CI / packaging checklist

| Item          | Action                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway       | Register all new domain plugins                                                                                                                                 |
| Docker/k8s    | Notification already present; add transport/comms/hostel/library services **or** keep in-process on gateway (prefer in-process for v1 like health/scholarships) |
| Feature flags | `features.transport`, `features.hostel`, `features.library`, `features.communication` on tenant                                                                 |
| DoD           | Tip-only prettier/eslint; schema SQL triggers Integration when `db/sql` changes                                                                                 |
| Lighthouse    | Add hub routes when gated                                                                                                                                       |

---

## Execution playbook (per workstream PR)

1. Start **enterprise-dev-session** (`mode: build`, modules subset).
2. Fill DEV checklist as you implement (SQL → API → UI → security).
3. Commit/push iteratively; tip CI green before hand-off.
4. Flip to **enterprise-test-session**; run production-ready skill end-to-end.
5. Set `pillars.*` true only with evidence; `status: complete` when done.
6. Update scoreboard + this plan’s status table.

### Suggested PR slicing (dependency-safe)

| PR  | Scope                                                                                       |
| --- | ------------------------------------------------------------------------------------------- |
| A   | WS0 nav inventory + empty route shells (no false “done”) **or** skip shells until API ready |
| B   | WS1 Notifications SQL + gateway mount + prefs/devices APIs                                  |
| C   | WS1 Web inbox + admin rules + test audit                                                    |
| D   | WS3 Transport SQL + mount + web screens + test audit                                        |
| E   | WS2 Communication campaigns + emergency + test audit                                        |
| F   | WS4 Hostel                                                                                  |
| G   | WS5 Library + transfer clearance hook                                                       |
| H   | Scoreboard / program readiness rollup                                                       |

Prefer **B→C** and **D** in parallel after WS0; **E** after B; **F/G** parallel after core student APIs stable.

---

## Status tracker

| WS                        | Status          | Tip / audit                            |
| ------------------------- | --------------- | -------------------------------------- |
| WS0 Inventory & contracts | **In progress** | Nav + DEV audits on tip                |
| WS1 Notifications         | **In progress** | SQL + prefs/devices + gateway + shells |
| WS2 Communication         | **Planned**     | —                                      |
| WS3 Transport             | **In progress** | SQL + gateway + shells                 |
| WS4 Hostel                | **Planned**     | —                                      |
| WS5 Library               | **Planned**     | —                                      |
| WS6 Enterprise test packs | **Planned**     | ungated smoke `20-…-inventory-smoke`   |

---

## Residual risks (pre-declare)

| Risk                                             | Mitigation                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| SMS/email provider credentials unavailable in CI | Adapter interface + recorded sandbox fixtures; waiver for live carrier until secrets |
| Segment queries expensive at 3k students         | Precompute audience materialization job; index enrollment FKs                        |
| Emergency false send                             | Dual confirm + role gate + dry-run preview                                           |
| Nav inventory churn vs redesign gallery          | Single source: update `redesign/index.html` + Next sidebar in same PR                |
| Scope creep (GPS, mess fees, OPAC)               | Enforced non-goals above                                                             |

---

## Related paths

- Skills: `.cursor/skills/enterprise-module-development/SKILL.md`, `.cursor/skills/enterprise-module-production-ready/SKILL.md`
- Templates: `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`, `ENTERPRISE_MODULE_TEST_CHECKLIST.md`
- Existing code: `packages/backend/notification/`, `packages/backend/transport/`, `apps/web/src/features/settings/pages/NotificationPreferences.tsx`, `apps/mobile/lib/features/notifications/`
- Redesign mocks: `redesign/web/notifications-center.html`, `redesign/web/admin-notification-rules.html`, `redesign/web/transport-*.html`
- SIS plan (orthogonal): `docs/plans/SIS_WORLD_CLASS_10_GAP_CLOSURE.md`
