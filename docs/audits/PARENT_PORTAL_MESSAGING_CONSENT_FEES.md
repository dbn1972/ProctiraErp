# Enterprise production-ready — Parent portal messaging / consent / fees

**Module:** Parent portal  
**Branch / tip:** `cursor/parent-student-portal-56c3`  
**Date (UTC):** 2026-09-07  
**Paired build audit:** `docs/audits/DEV_PARENT_PORTAL_MESSAGING_CONSENT_FEES.md`  
**Status:** Ready w/ waivers (WS4 tip CI ☑)

## Scope

| Screen   | Route                                             |
| -------- | ------------------------------------------------- |
| Home     | `/parent`                                         |
| Messages | `/parent/messages`, `/parent/messages/[threadId]` |
| Consents | `/parent/consents`                                |
| Fees     | `/parent/fees`                                    |

## Evidence

| Pillar              | Status | Evidence                                                            |
| ------------------- | ------ | ------------------------------------------------------------------- |
| Inventory smoke     | ☑      | `e2e/22-parent-portal-smoke.spec.ts` (ungated)                      |
| UX route lists      | ☑      | dark/touch/a11y/capture include `/parent*`                          |
| Backend unit        | ☑      | `@proctira/backend-parent-portal` 10 tests                          |
| Gated writes        | ☑      | link/message/consent/pay + cross-tenant empty list                  |
| Dedicated shell     | ☑      | `ParentPortalShell` (`data-shell="parent"`) — not staff MobileShell |
| Flutter parent mode | ☑      | `/parent` routes; staff shells unchanged                            |
| Tip CI              | ☑      | PR #25 @ `7656860` — 13/13 SUCCESS ([CI](https://github.com/dbn1972/ProctiraErp/actions/runs/34121340677)); `docs/audits/evidence/parent-portal-ws4-tip-ci-evidence.json` |

## Waivers

- Live payment provider (sandbox honesty)
- Live IdP / device-farm program-wide
