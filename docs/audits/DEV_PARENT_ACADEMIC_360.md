# Development checklist — Parent academic 360 (UI)

**Capability / module:** Parent academic 360 UI close  
**Branch / tip:** `cursor/parent-academic-360-56c3`  
**Owner / agent:** Cloud agent  
**Date (UTC):** 2026-09-11  
**Peer parity target:** Parent can open LMS / report-cards / PAL like grades/homework  
**Paired product audit:** `docs/audits/PRODUCT_PARENT_ACADEMIC_360.md`

## 0. Product contract

| Item                 | Content                                                  |
| -------------------- | -------------------------------------------------------- |
| Capability statement | Wire existing parent-portal academic APIs into parent UI |
| In scope             | Client + pages + nav + smoke/route audit                 |
| Explicit non-goals   | New backend stores; sealed PDF; live IdP secrets         |
| Roles (RBAC)         | Parent linked-child reads only                           |

## 1–7. Build notes

| Area             | Done | Evidence                                                           |
| ---------------- | ---- | ------------------------------------------------------------------ |
| SQL / new tables | N/A  | Headless APIs already on main                                      |
| API client       | ☑    | `getChildLms` / `getChildReportCards` / `getChildPalPlan` (+ self) |
| UI pages         | ☑    | `apps/web/src/app/(parent)/parent/{lms,report-cards,pal}/page.tsx` |
| Nav              | ☑    | `ParentPortalShell`                                                |
| Tests            | ☑    | route-audit + e2e G-904 lists                                      |
| Cross-tenant     | ☑    | Existing parent-portal deny; UI shows forbidden honesty            |

## Explicit non-claims

Do not claim product 10/10, Canvas parity, or live Keycloak login from this slice.
