# Security — W1-SEC-02 COMPLETE (exact mutating-route authz inventory)

**Module / slice:** `apps/api-gateway` mutating authz inventory + enforce helper · encapsulation fixes for billing / examination / staff plugin-wide hooks  
**Branch / tip:** `cursor/w1-sec-02-authz-complete-56c3` @ `e879af0569dd5a6b2aa084d7fcab650eac7d1886` (implementation) · docs tip follows  
**Date (UTC):** 2026-09-14  
**Data classes:** mixed (PII / PHI / financial / campus ops) via `/api/v1/*` mutations  
**Paired finding:** W1-SEC-02 (critical) PARTIAL → COMPLETE  
**Prior residuals:** D1–D5 route guards; scholarship `#183`; hostel `#193`

---

## 0. Inventory

| Surface | AuthN | AuthZ | Data class | Notes |
| ------- | ----- | ----- | ---------- | ----- |
| Mutating `/api/v1/*` (all mounted domains) | JWT | **Inventory-declared** `{resource, action}` via `mutating-route-authz.ts` | mixed | Fail closed if no covering rule |
| Read `/api/v1/*` | JWT | Coarse URL-segment + HTTP-method (`PATH_RESOURCE_MAP` / `actionForMethod`) | mixed | **Accepted residual** |
| Examination documents / ops / results | JWT + domain | Plugin-wide `document.generate` / `ops.moderate` / result write | PII | **Accepted residual** (encapsulated so hooks do not leak) |
| Billing plugin-wide `billing.manage` | JWT + domain | Platform admin only | financial | Encapsulated under billing prefix |
| Deferred domains (transport, library, registration, communication, lms, notification, …) | JWT | Inventory coarse resource + method action | mixed | No package `*-access` HTTP guards yet; coverage test fails on **new** uninventoried routes |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Every mutating route covered by inventory | ☑ | `mutating-route-authz.test.ts` — registered routes vs inventory |
| Missing inventory → fail closed | ☑ | `evaluateExactMutatingAuthzGate` + unmapped POST → 403 |
| Inventory-backed insufficient-permission denial | ☑ | `INVENTORY_DENY_SAMPLES` (exam docs, fees, hostel, transport, library, registration, scholarship, staff) |
| Allowed role clears gateway exact guard | ☑ | Same samples — not 403 for admin (domain may still 4xx) |
| Plugin-wide hooks do not leak via `fp` | ☑ | Encapsulated `register()` in billing / examination / staff plugins |
| Coarse read mapping retained | ☑ | Non-mutating path still uses `resourceForApiPath` |
| No secrets in git | ☑ | Test JWT secrets only |

---

## 2. Findings

### P0

| ID | Finding | Fix |
| --- | ------- | --- |
| W1-SEC-02 | Mutating routes relied on coarse URL-segment inference without an exact inventory declaration; new routes could ship ungarded | Inventory + enforce helper; fail closed on miss; coverage test |
| W1-SEC-02 (leak) | Billing / examination / staff `fp` plugins installed plugin-wide `preHandler` hooks on the root gateway (tenant admin writes denied as `billing.manage`) | Encapsulate route modules in child contexts |

### P1 / P2 residuals (honest)

| ID | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| residual | P1 | Deferred domains still lack package-level domain action helpers (`transport`, `library`, `registration`, `communication`, `lms`, `notification`, peers) | Inventory declares coarse resource/action; coverage test fails when **new** mutating routes are registered without inventory rules |
| residual | P2 | Coarse URL-segment/HTTP-method authorization remains for **reads** | Accepted per COMPLETE acceptance |
| residual | P2 | Plugin-wide domain permissions remain (e.g. examination `document.generate` on all mutating verbs in that module) | Accepted; hooks encapsulated |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| P0 cleared | ☑ |
| P1 cleared or waived | ☑ waived → deferred domain package guards (inventory fail-closed for new routes) |
| Safe to merge from security view | ☑ W1-SEC-02 COMPLETE with documented residuals |

**Residual risks:** Transport / library / registration (and peers) still need hostel/scholarship-style package `*-access` guards for domain-action depth. Until then, gateway inventory exact resource/action + fail-closed coverage is the COMPLETE bar. Coarse read mapping and encapsulated plugin-wide write hooks remain by design.

## Follow-up (transport package guards)

Cleared `transport` from deferred domain-guard residuals:

- `transport-access.ts` / `transport-http-guard.ts` — fail-closed role matrix
- `registerTransportRoutes` preHandler maps GET→read, mutations→write
- `DOMAIN_GUARD_COMPLETE_RESOURCES` includes `transport`
- Evidence: `transport-access.test.ts`, `routes.test.ts` (403 fail-closed), mutating inventory tests

