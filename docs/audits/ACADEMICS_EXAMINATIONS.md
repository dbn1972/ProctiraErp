# Enterprise module test — Academics · Examinations

**Module:** Academics — Examinations  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** App Router `(dashboard)/examinations*` + gateway `examinationPlugin` → `packages/backend/examination` (`POST /examinations`)  
**Tester / agent:** Cursor cloud agent  
**Date (UTC):** 2026-09-06  
**Enterprise session:** `.cursor/hooks/state/enterprise-test-session.json`

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

---

## 0. Screen inventory

| Nav label | Route | Roles | PII/PHI | Notes |
| --- | --- | --- | --- | --- |
| Examinations · list | `/examinations` | `examination.read` | Low | Table + Schedule CTA |
| Examinations · schedule (create) | `/examinations/new` | `examination.write` | Low | **Wired** to `POST /examinations` via server action |
| Examinations · detail | `/examinations/[id]` | `examination.read` | Low | Overview |
| Examinations · candidates | `/examinations/[id]/candidates` | `examination.read/write` | Medium | Candidate list |
| Examinations · results | `/examinations/[id]/results` | `examination.read` | Medium | Scores |
| Examinations · documents | `/examinations/[id]/documents` | `examination.read` | Low | Admit cards / certificates |

API surface: `apps/web/src/lib/api/examinations.ts` (`createExamination`, list/get/normalize `startDate` → `examinationDate`), `apps/web/src/app/(dashboard)/examinations/actions.ts`, validation `apps/web/src/lib/validation/examination-schema.ts` (mirrors `CreateExaminationSchema`).

---

## 1. Functionality

| Screen | Load OK | Empty/loading/error | Write path or N/A | Evidence |
| --- | --- | --- | --- | --- |
| `/examinations` | ☑ code path | empty CTA | N/A list | `listExaminations` |
| `/examinations/new` | ☑ | client zod + server field errors | **`createExaminationAction` → POST** | form + action; honest gateway error (no demo-ack) |
| `/examinations/[id]` | ☑ when id exists | `notFound` on missing | N/A read | layout `getExamination` |
| candidates / results / documents | ☑ when id exists | empty lists | N/A read this pass | list* helpers |

Backend unit/property: ☑ historical — `packages/backend/examination` route tests cover `POST /examinations` 201/400/409; not re-run in this web uplift pass.

**Create alignment:** UI collects name, code, description, academicPeriodId, start/end dates, ≥1 subject, ≥1 centre (institution + capacity), ≥1 grading scheme (default A/B/C/F). Client enforces start ≥7 days ahead (service rule).

---

## 2. E2E (Playwright)

| Journey | Spec file | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence |
| --- | --- | --- | --- | --- | --- |
| Unauthenticated → `/login` | `apps/web/e2e/19-examinations-inventory-smoke.spec.ts` | N/A | ☐ CI | ☐ | list + new |
| Session shell + create validation | `19-…` | Create hit live gateway in cloud run (success banner) | ☑ chromium | ☐ | 13 passed / 11 skipped across 19–21 (2026-09-06) |
| Detail tabs | `19-…` seeded describe | ☐ gated | ☐ | ☐ | Needs real exam id |

---

## 3. UX / a11y

| Check | Pass | Evidence |
| --- | --- | --- |
| axe WCAG 2.1 AA on module routes | ☐ gated | Not extended this pass |
| Dark mode parity | ☐ | Not confirmed for `/examinations*` this pass |
| Touch targets ≥44px / ≥48px mobile | ☐ | Not confirmed this pass |
| RTL smoke (if locale enabled) | ☐ | Not exam-specific |
| Keyboard / focus | ☐ | Pending live pass on expanded create form |

---

## 4. Multidevice captures

| Screen | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path |
| --- | --- | --- | --- | --- |
| list / new / detail tabs | ☐ | ☐ | ☐ | **No PNG pack invented** — capture not run this pass |

Horizontal scroll / clipped CTA issues: unknown without captures. Create form is denser after schema alignment — mobile layout residual.

---

## 5. Security

| Check | Pass | Evidence |
| --- | --- | --- |
| Unauthenticated redirect | ☑ | Middleware + ungated describe in `19-…` |
| RBAC deny / hide | ☐ gated | `examination.read` in route-permission coupling property test; live UI deny not re-proven |
| Cross-tenant IDOR blocked (API) | ☐ | Examination service tenant scoping — cite when live |
| Cross-tenant IDOR blocked (UI) | ☐ | Relies on API |
| No secrets/PHI leaked in git artifacts | ☑ | No screenshots committed this pass |
| Tenant isolation suite cited/run | ☐ | Not re-run this pass |

---

## 6. CI / production gates

| Gate | Pass | Link / SHA |
| --- | --- | --- |
| Lint / typecheck / unit | ☐ tip CI | After push |
| Integration (if DB touched) | N/A web-only wiring | Examination domain tests exist in package |
| DoD / Lighthouse / tenant gate | ☐ | Tip CI |

---

## 7. Residual risks / waivers

| Item | Risk | Owner | Waiver date |
| --- | --- | --- | --- |
| Live create E2E needs seed FKs | Academic period + institution must exist for 201 | QA | 2026-09-06 |
| Detail inventory gated | Fake UUID notFound without backend | QA | 2026-09-06 |
| Multidevice PNG pack missing | No visual evidence | QA | 2026-09-06 |
| Academic period is UUID text field | No period picker UX yet | Product | 2026-09-06 |
| Single subject/centre row in UI | Schema allows arrays; UI collects min-1 only | Product | 2026-09-06 |
| List `examinationDate` | Normalized from API `startDate` — legacy field name retained | Platform | 2026-09-06 |

---

## Done criteria

- [x] Screen inventory for examinations  
- [x] Create wired to real `POST /examinations` (honest errors when gateway down)  
- [x] Ungated + validation smoke updated (`19-examinations-inventory-smoke.spec.ts`)  
- [ ] Multidevice PNGs  
- [ ] Live create happy path with seeded period/institution  
- [ ] Session state `complete` after tip CI  

**Verdict:** ☐ Not ready · ☑ Ready with waivers (API-aligned create + audits + ungated smokes; live seed/multidevice residual) · ☐ Enterprise production-ready
