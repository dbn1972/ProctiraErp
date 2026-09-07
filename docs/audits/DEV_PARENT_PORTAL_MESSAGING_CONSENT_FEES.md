# Enterprise module development — Parent / student portal

**Capability / module:** Parent portal · messaging · consent · fee pay  
**Branch / tip:** `cursor/parent-student-portal-56c3`  
**Date (UTC):** 2026-09-07  
**Peer parity target:** Dedicated guardian portal with messaging, consent, fee pay (PowerSchool / Infinite Campus parent portals)  
**Dev session:** `.cursor/hooks/state/enterprise-dev-session.json`  
**Paired test audit:** `docs/audits/PARENT_PORTAL_MESSAGING_CONSENT_FEES.md`

## 0. Product contract

| Item                 | Content                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | Guardians use a dedicated parent shell (web `/parent` + Flutter `/parent`) to see linked children, message the school, approve consents, and pay student fee invoices via sandbox — without the staff ERP chrome. |
| In scope             | Child links, threads+replies, consent ledger, fee invoices+sandbox pay, gateway mount, staff shells preserved                                                                                                     |
| Explicit non-goals   | Live PSP, full gradebook parent view, replacing staff MobileShell                                                                                                                                                 |
| Roles                | `parent` / `guardian` / `student` → `/parent`; staff create invoices/consents                                                                                                                                     |

## 1–6 Evidence

| Pillar       | Status | Evidence                                                                      |
| ------------ | ------ | ----------------------------------------------------------------------------- |
| SQL          | ☑      | `db/sql/010_parent_portal_schema.sql` + `010b` seed                           |
| Backend      | ☑      | `@proctira/backend-parent-portal` (10 unit tests)                             |
| Gateway      | ☑      | `DOMAIN_REGISTRARS` `parent-portal`                                           |
| Web UI       | ☑      | `(parent)/parent/*` + `ParentPortalShell`                                     |
| Mobile       | ☑      | Flutter `/parent/*`; staff home remains staff-leaning (+ Parent quick action) |
| Role routing | ☑      | parent/guardian/student → `/parent`                                           |

## Residual

- Live UPI/card PSP credentials
- Full Flutter API-backed message/fee clients (shells + web complete)
