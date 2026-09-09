# Enterprise security & tenancy checklist

**Module / slice:** Transport ops (G-920)  
**Branch / tip:** `cursor/w9-g920-transport-56c3`  
**Date (UTC):** 2026-09-09  
**Data classes:** PII (student ids), location (GPS), financial (fee amounts)  
**Paired test audit:** E2E spec present, **not executed**

---

## 0. Inventory

| Route / API             | AuthN            | AuthZ             | Data class      | Notes                     |
| ----------------------- | ---------------- | ----------------- | --------------- | ------------------------- |
| `/transport/stops`      | JWT              | `transport`       | stop names      |                           |
| `POST /transport/gps`   | JWT + device key | `transport` write | lat/lng         | anonymous ingest deferred |
| `GET /transport/live`   | JWT              | `transport` read  | lat/lng         | last ping per vehicle     |
| `/transport/attendance` | JWT              | `transport`       | student ids     |                           |
| `/transport/alerts*`    | JWT              | `transport`       | student/vehicle |                           |
| `/transport/fee-*`      | JWT              | `transport`       | amounts         | via FeesService           |

---

## 1. Controls

| Check                                   | Pass | Evidence                                 |
| --------------------------------------- | ---- | ---------------------------------------- |
| Unauthenticated → sign-in / 401         | ☐    | not live-tested                          |
| RBAC deny / hide                        | ☐    | existing `/transport` mapping            |
| Cross-tenant IDOR blocked (API)         | ☐    | RLS + tenant filters; E2E gated, not run |
| Cross-tenant IDOR blocked (UI)          | ☐    |                                          |
| Write audit events (money/consent/PHI)  | ☐    | fees ledger if invoiced                  |
| No secrets/tokens in git or client logs | ☑    | device key hashed SHA-256                |
| Tenant isolation suite cited/run        | ☑    | unit SQL RLS for 045                     |
| Input validation / abuse basics         | ☑    | TypeBox + Zod                            |

## 2. Findings

Anonymous telematics without JWT is deferred (FORCE RLS needs `app.tenant_id`). Device key is a second factor inside the tenant.

**Verdict:** PARTIAL — not “secure” without live cross-tenant proof.
