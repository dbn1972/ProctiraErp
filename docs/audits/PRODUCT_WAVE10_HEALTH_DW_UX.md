# Enterprise product / IA — Wave 10B/C + UX leftovers

**Module / slice:** Health Option B · DW/ETL Option C · Batch-3 UX B3-006…B3-012  
**Branch / tip:** `cursor/w10-health-dw-ux-56c3`  
**Date (UTC):** 2026-09-10  
**Owner / agent:** Cursor cloud agent

---

## 1. Capability statement

School nurses and health admins can register allergies and vaccinations against student health records, review PHI access logs for audit, and log nurse-visit incidents. BI operators can run a thin ETL pipeline surface (unparked from G-924) with durable pipeline metadata, and board officers get hardened board rollups (deny other boards + clearer picker). Operators using attendance ops, transport live, LMS, and reports get the remaining Wave 9 batch-3 UX polish.

## 2. Personas & jobs

| Persona                | Job-to-be-done                  | Success looks like                                            |
| ---------------------- | ------------------------------- | ------------------------------------------------------------- |
| Nurse / health officer | Record allergy & vaccination    | Create + list on health routes; show on student health detail |
| Health admin           | Audit who viewed PHI            | Read-only PHI access log page                                 |
| Nurse                  | Log a clinic visit incident     | Create + list nurse incidents                                 |
| BI / tenant admin      | Configure a CSV/import pipeline | Mounted `/pipelines` CRUD with PG when DATABASE_URL           |
| Board officer          | View own board rollup only      | 403 on other boards; picker on `/reports`                     |
| Staff operators        | Faster forms / readable mobile  | B3-006…B3-011 fixed; B3-012 waived                            |

## 3. Scope

| In scope                                           | Non-goals                                        |
| -------------------------------------------------- | ------------------------------------------------ |
| Allergy + vaccination App Router UI + actions      | Medication administration, health consent        |
| PHI access log list API + viewer                   | Field-level PHI decrypt UI                       |
| Nurse incidents SQL + API + UI                     | Student discipline incidents (already elsewhere) |
| ETL thin un-park: schema + Pg repo + gateway mount | Full DevInfo warehouse package un-park           |
| G-809 harden: board-scoped deny + picker UX        | Unpark `backend/dashboards`                      |
| B3-006…B3-011 code fixes; B3-012 doc waiver        | Flutter / mobile native health                   |

## 4. Peer parity

| Peer capability                                | Our target                    |
| ---------------------------------------------- | ----------------------------- |
| Infinite Campus health allergies/immunizations | Create + student-scoped lists |
| PowerSchool health office visits               | Nurse incident register       |
| BI scheduled extract                           | Mounted ETL pipelines (thin)  |
| Board multi-school rollup ACL                  | Deny cross-board              |

## 5. Surface map

| Nav / page    | Route                                 | API                          | Data                         |
| ------------- | ------------------------------------- | ---------------------------- | ---------------------------- |
| Allergies     | `/health/allergies`                   | `/health/allergies*`         | `health_allergies`           |
| Vaccinations  | `/health/vaccinations`                | `/health/vaccinations*`      | `health_vaccinations`        |
| PHI access    | `/health/phi-access`                  | `GET /health/phi-access`     | `health_phi_access_log`      |
| Incidents     | `/health/incidents`                   | `/health/incidents*`         | new `health_nurse_incidents` |
| Pipelines     | `/admin/pipelines` or `/pipelines` UI | `/pipelines*`                | new ETL SQL                  |
| Board summary | `/reports`                            | `/reports/board/:id/summary` | insights                     |

## 6. Roles & tenancy

| Role                        | Can                                   | Cannot                   |
| --------------------------- | ------------------------------------- | ------------------------ |
| Nurse / health_officer      | Allergy/vacc/incident CRUD for tenant | Cross-tenant PHI         |
| health_admin / system_admin | PHI access log                        | Other tenants            |
| report reader               | Own board summary                     | Other board IDs (403)    |
| tenant admin                | ETL pipelines for tenant              | Other tenants' pipelines |

## 7. Success metrics / DoD

- [x] Allergy + vaccination create/list smoke (UI + domain APIs; allergy e2e 17b prior)
- [x] PHI access page for privileged role; deny unprivileged (UI gate + service)
- [x] Nurse incidents create/list (PG when `DATABASE_URL` via `046`)
- [x] ETL package mounted; mount-matrix test green; PG when DATABASE_URL
- [x] Board summary cross-board 403 + unit (`insights-ui-plugin.test.ts`)
- [x] B3-006…B3-011 UI fixes; B3-012 waived in UX review
- [ ] Tip CI green

## 8. Handoff

| Next    | Path              |
| ------- | ----------------- |
| Build   | this branch       |
| Test    | e2e + vitest + CI |
| Release | PR → main         |
