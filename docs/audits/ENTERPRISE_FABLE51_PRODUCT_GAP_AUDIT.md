# ProctiraERP — Enterprise product gap audit (Fable 5.1)

**Date:** 2026-09-08  
**Method:** Parallel Fable 5.1 explore agents + project enterprise skills map  
**Skills applied:** `enterprise-module-production-ready`, `enterprise-security-tenancy`, `enterprise-product-ia`, `enterprise-ux-designer`, `enterprise-accessibility`, `enterprise-data-sql-certification`, `enterprise-release-ops`, `enterprise-mobile-flutter`, `enterprise-module-development`  
**Honesty rule:** Live IdP / Twilio / PSP / LMS / Statuspage remain **dated external waivers** until secrets + evidence exist. Do not claim 10/10 on waived pillars.

---

## 1. Executive verdict

ProctiraERP has a **strong blueprint and partial implementation**: SIS timetable/gradebook depth, peer-gap closure queue #1–#10 closed on `main`, optional Keycloak path in flight (PR #38), and a solid skill/checklist culture.

It is **not yet an enterprise-complete product**. The dominant failure mode is **controls and persistence not composed into the running gateway**:

| Pillar | Score (0–10) | One-line gap |
|--------|-------------:|--------------|
| Security & tenancy | **3.5** | Campus/health/fees APIs largely **without gateway RBAC**; forgeable actors; RLS incomplete |
| Functionality / data plane | **4.5** | Dual stack (Prisma vs raw SQL 002–014); many domains **in-memory** or unmounted |
| UX / a11y / multidevice | **5.0** | Authenticated axe/dark/touch/RTL often **skipped in CI**; MobileShell dead routes |
| Platform / ops / release | **4.0** | Admin console stub; `rbacPlugin`/audit/tenant lifecycle **unmounted**; deploy gaps |
| E2E / evidence | **4.0** | Playwright gated on `E2E_BACKEND_READY`; not a CI merge gate for live writes |
| **Overall enterprise readiness** | **~4 / 10** | Shipable as demo/staging only until Wave 1 security + schema apply |

**Peer-gap queue #1–#10 = closed** does **not** equal full product enterprise readiness. It closed a prioritized peer-delta list; this audit covers the **whole product surface**.

---

## 2. Cross-cutting findings (whole product)

### 2.1 Security (critical)

1. **No gateway RBAC wired for campus modules** — Health, fees, leave, admissions, hostel, transport, library, comms, notifications, scholarships, parent portal plugins register routes without the same permission coupling as core SIS student/staff paths.
2. **Forgeable actor identity** — Request headers / body fields used as actor where JWT subject should be authoritative.
3. **Platform-admin UI without authZ** — Stub console can appear operable without real admin RBAC.
4. **Optional Keycloak** — Local HS JWT remains default; live IdP E2E still waived until secrets.
5. **PHI / money paths** — Health and fees lack vault/PSP-grade controls in the live compose path; treat as high risk until hardened.
6. **RLS** — Many tables lack tenant RLS; raw SQL 002–014 not applied by default tooling.

### 2.2 Functionality / architecture

1. **Dual schema** — Prisma models vs raw SQL (`db/sql/001` + `002–014`) diverge; apply path unclear for agents and CI.
2. **Unmounted routes** — Substantial backend packages exist but are not registered on the api-gateway used in local/CI.
3. **In-memory domains** — Scholarships, parts of admissions CRM, identity invite/OTP (until Keycloak+store), and similar stores reset on restart.
4. **SIS depth uneven** — Timetable/gradebook stronger; board exports, master schedule hardening, and RBAC on remaining SIS APIs incomplete.

### 2.3 UX / accessibility / mobile

1. Authenticated **axe / dark / touch / RTL** specs skip without backend-ready env → CI green without proving a11y.
2. **MobileShell** routes to broken or empty destinations.
3. **i18n** parity incomplete; flat nav IA for large modules.
4. Flutter a11y / device-farm evidence thin vs web.

### 2.4 Release / ops

1. Helm/deploy and observability SLO packs incomplete vs enterprise release skill.
2. Bundle/Lighthouse/integration gates exist but do not compensate for skipped E2E write paths.
3. Multi-board live DB certification procedure exists in skill; not yet a standing green proof for all modules.

---

## 3. Module heat map

| Area | Security | Function | UX/E2E | Priority |
|------|:--------:|:--------:|:------:|----------|
| Platform admin / RBAC / audit | ●○○ | ●○○ | ●○○ | **P0** |
| Health / PHI | ●○○ | ●●○ | ●●○ | **P0** |
| Fees / finance | ●○○ | ●●○ | ●●○ | **P0** |
| SIS core (students/staff/enroll) | ●●○ | ●●● | ●●○ | **P0** |
| Timetable / gradebook | ●●○ | ●●● | ●●○ | **P1** |
| Admissions / CRM | ●○○ | ●●○ | ●●○ | **P1** |
| Scholarships | ●○○ | ●○○ | ●●○ | **P1** |
| Leave / HR | ●○○ | ●●○ | ●●○ | **P1** |
| Hostel / transport / library | ●○○ | ●●○ | ●●○ | **P2** |
| Comms / notifications | ●○○ | ●●○ | ●●○ | **P2** |
| Parent / student portal | ●○○ | ●●○ | ●●○ | **P1** |
| Public website / registration | ●●○ | ●●○ | ●●○ | **P2** |
| Mobile Flutter | ●○○ | ●●○ | ●○○ | **P2** |
| Insights / workflows | ●○○ | ●●○ | ●●○ | **P2** |

Legend: ●●● stronger relative to peers · ●○○ weak.

---

## 4. Explicit external waivers (do not Autocomplete)

| Waiver | Evidence required later |
|--------|-------------------------|
| Live Keycloak / IdP E2E | Secrets + recorded login journey |
| Twilio SMS / voice | Account + delivery receipt |
| Payment PSP (fees) | Sandbox charge + webhook |
| LMS / LTI sandbox | Tool launch proof |
| Statuspage / pager | Incident page + alert |
| Device-farm Flutter PNGs | Farm run artifacts |

Agents may implement **code paths and mocks**, but must mark these pillars **waived** in module audits until live evidence exists.

---

## 5. Auto-mode Cursor subagent task queue

Use **one PR / one concern** per agent where possible. Each task lists: **ID**, **goal**, **skill**, **acceptance**, **depends on**.

### Wave 0 — Prerequisites (serial)

| ID | Task | Skill | Acceptance | Depends |
|----|------|-------|------------|---------|
| **W0-01** | Merge or land optional Keycloak slim (PR #38) when tip CI green; document env gates | release-ops | `KEYCLOAK_*` optional; HS JWT default documented; CI green | — |
| **W0-02** | Single **schema apply story**: document + script which of Prisma vs `db/sql/001–014` is canonical for local/CI/cert | data-sql | `setup-live-db` (or successor) applies one coherent set; README one path | — |
| **W0-03** | Inventory **unmounted** gateway plugins vs packages; publish mount matrix | module-dev | Markdown matrix: package → mounted? → owner | W0-02 |

### Wave 1 — Security composition (P0, parallel after W0)

| ID | Task | Skill | Acceptance | Depends |
|----|------|-------|------------|---------|
| **CAMP-00** | Wire **gateway RBAC** for all campus plugins (health, fees, leave, admissions, hostel, transport, library, comms, notifications, scholarships, parent) | security-tenancy | Every mutating route has permission check; deny tests | W0-03 |
| **PA-01** | Mount `rbacPlugin` + audit middleware on api-gateway | security-tenancy | Audit events on admin mutations; unit + integration | W0-03 |
| **PA-02** | Platform-admin UI: real authZ gate (no stub-operable without role) | security-tenancy + product-ia | Unauthenticated → login; non-admin → 403 UI | PA-01 |
| **SIS-RBAC** | Finish RBAC on remaining SIS APIs (not only students smoke) | security-tenancy | `09-route-permission` extended; cross-tenant deny | W0-03 |
| **ACTOR-01** | Eliminate forgeable actors: JWT `sub` only; strip client actor headers | security-tenancy | Property/unit tests prove header override fails | CAMP-00 |
| **RLS-01** | Add/enable tenant RLS for tables in active SQL set; migrate tooling | data-sql + security | Tenant isolation tests pass on live Postgres | W0-02 |

### Wave 2 — Persistence & money/PHI (P0/P1)

| ID | Task | Skill | Acceptance | Depends |
|----|------|-------|------------|---------|
| **HLT-01** | Health PHI vault path: encrypt/store policy + access audit | security-tenancy | No plaintext PHI in logs; audit on read | CAMP-00, RLS-01 |
| **HLT-02** | Health screenings E2E (backend-ready) + tenant deny | production-ready | Evidence pack under artifacts + audit md | HLT-01 |
| **FEE-01** | Fees ledger persistence (not memory); idempotent payments stub | module-dev + data-sql | Restart-safe balances; dual-entry invariants | CAMP-00, W0-02 |
| **FEE-02** | Fees RBAC + parent fee visibility rules | security-tenancy | Role matrix tests | FEE-01, ACTOR-01 |
| **SCH-01** | Scholarships: replace in-memory with SQL; applications + disbursements | module-dev | CRUD survives restart; tenant scoped | W0-02, CAMP-00 |
| **ADM-01** | Admissions CRM: persist pipeline; remove memory store | module-dev | Seed + list/detail write path | W0-02, CAMP-00 |
| **HRL-01** | Leave: persistence + manager approve path with RBAC | module-dev | Approve/deny audit trail | CAMP-00 |

### Wave 3 — SIS depth & portals (P1)

| ID | Task | Skill | Acceptance | Depends |
|----|------|-------|------------|---------|
| **SIS-01** | Mount missing SIS routes declared in packages | module-dev | Mount matrix green for SIS | W0-03 |
| **SIS-TT** | Timetable conflict/UX UUID cleanup (human labels) | ux-designer + module-dev | No raw UUID primary labels in UI | SIS-01 |
| **SIS-GB** | Gradebook harden: permissions, publish, export | module-dev + security | Teacher vs admin matrix; export job | SIS-RBAC |
| **SIS-MS** | Master schedule harden vs peer plan | module-dev | Conflicts surfaced; audit | SIS-01 |
| **SIS-BE** | Board exports production path | module-dev + release | Job + download + tenant check | SIS-GB |
| **PAR-01** | Parent portal: messaging, consent, fees against live API | production-ready | Authenticated journey evidence | FEE-02, CAMP-00 |
| **STU-01** | Student portal parity for grades/attendance read | production-ready | Role-scoped read E2E | SIS-GB |

### Wave 4 — UX / a11y / mobile / E2E CI (P1/P2)

| ID | Task | Skill | Acceptance | Depends |
|----|------|-------|------------|---------|
| **UXA-01** | Ungate or split CI: authenticated axe suite with seed user | accessibility | CI job runs axe on module route list; 0 critical | Wave 1 |
| **UXA-02** | Dark / touch / RTL same as UXA-01 for Health, Fees, SIS, Scholarships | accessibility + ux | Specs not skipped in that job | UXA-01 |
| **UXA-03** | Fix MobileShell dead routes; capture mobile PNGs | ux + mobile | Shell nav → real screens; artifacts | — |
| **UXA-04** | i18n parity pass for nav + top modules | product-ia | No hardcoded EN-only critical strings | — |
| **MOB-01** | Flutter a11y semantics + golden/smoke | mobile-flutter | Semantics audit checklist filled | UXA-03 |
| **E2E-01** | Document `E2E_BACKEND_READY` CI optional job; seed recipe | production-ready + release | Nightly or manual workflow green | W0-02 |
| **CERT-01** | Multi-board 3×2×500 live onboard proof; refresh audit md | data-sql | Counts verified; artifacts | W0-02 |

### Wave 5 — Remaining campus & ops (P2)

| ID | Task | Skill | Acceptance | Depends |
|----|------|-------|------------|---------|
| **HOS-01** | Hostel occupancy: RBAC + SQL + E2E smoke | production-ready | Evidence pack | CAMP-00 |
| **TRN-01** | Transport routes/fleet same | production-ready | Evidence pack | CAMP-00 |
| **LIB-01** | Library circulation same | production-ready | Evidence pack | CAMP-00 |
| **COM-01** | Campaigns/emergency: RBAC + provider stub + audit | security + module-dev | No send without role; audit | CAMP-00 |
| **NTF-01** | Notifications inbox/prefs persistence | module-dev | Prefs survive restart | CAMP-00 |
| **PA-OPS** | Helm/observability/SLO pack close vs release skill | release-ops | Checklist evidence | PA-01 |
| **INS-01** | Insights/workflows enterprise E2E pack | production-ready | Module audit md | CAMP-00 |
| **WEB-01** | Public website + registration portal enterprise packs | production-ready | Separate audits | — |

---

## 6. Suggested Auto-mode agent packing

Spawn **parallel** agents only within a wave and only on **non-overlapping paths**.

| Pack | Agents (parallel) | Branch prefix suggestion |
|------|-------------------|--------------------------|
| **A — Security spine** | CAMP-00, PA-01, SIS-RBAC, ACTOR-01 | `cursor/camp-rbac-56c3`, `cursor/platform-rbac-56c3`, … |
| **B — Data plane** | W0-02 owner then RLS-01, FEE-01, SCH-01, ADM-01 | `cursor/*-persist-56c3` |
| **C — PHI/money harden** | HLT-01→02, FEE-02 | after Pack A+B |
| **D — SIS UX depth** | SIS-TT, SIS-GB, SIS-MS, SIS-BE | after SIS-01 |
| **E — Evidence CI** | UXA-01–03, E2E-01, CERT-01 | after Pack A |
| **F — Long tail campus** | HOS/TRN/LIB/COM/NTF | after CAMP-00 |

**Do not** open mega-PRs mixing Prisma schema rewrites + UI redesign + IdP. Prefer slim PRs like Keycloak optional (#38 pattern).

---

## 7. Per-agent prompt template (Auto mode)

```text
You are a Cursor Auto-mode subagent for ProctiraERP.
Task ID: <ID>
Read and obey: .cursor/skills/<skill>/SKILL.md and
docs/audits/ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md § for this ID.
Branch: cursor/<short>-56c3 from origin/main (or current if continuing).
Implement ONLY this task. Commit, push, open/update draft PR.
Acceptance: <paste Acceptance>.
Honesty: mark external waivers; do not claim live IdP/PSP/Twilio.
Before claiming done: run relevant unit/lint; attach evidence paths.
```

---

## 8. Definition of “enterprise product complete” (program bar)

All must be true (waivers only where dated in §4):

1. **Security:** Gateway RBAC + RLS + non-forgeable actors on every module with data; platform-admin authZ real.
2. **Function:** No critical domain left in-memory; schema apply single path; unmounted matrix empty for shipped nav.
3. **UX:** Authenticated axe/dark/touch on shipped modules in CI (or scheduled job with badge).
4. **E2E:** Critical write journeys with `E2E_BACKEND_READY` evidence packs per `enterprise-module-production-ready`.
5. **Data cert:** Multi-board onboard counts verified.
6. **Release:** Tip CI green; deploy/observability checklist for staging.
7. **Mobile:** Shell routes valid; Flutter semantics minimum bar.

Until then, scoreboard claims must stay below **program production-ready**.

---

## 9. Immediate next three Auto agents (start here)

1. **W0-02** — Canonical schema apply story (unblocks almost everything).  
2. **CAMP-00** — Campus gateway RBAC (largest security delta).  
3. **PA-01 + PA-02** — Mount RBAC/audit + lock platform-admin UI.

Then: **ACTOR-01**, **RLS-01**, **HLT-01**, **FEE-01**.

---

## 10. Sources

- Fable 5.1 parallel explores (SIS, campus ops, platform, UX/a11y) — 2026-09-08  
- `.cursor/skills/enterprise-module-production-ready/SKILL.md` (+ related skills)  
- `docs/plans/PEER_GAP_CLOSURE_QUEUE.md` (closed #1–#10 — necessary but not sufficient)  
- Prior audits under `docs/audits/DEV_SIS_*`, `SEC_*`, module DEV_* files  

---

*End of report. Update this file when a Wave completes; link PRs beside each task ID.*
