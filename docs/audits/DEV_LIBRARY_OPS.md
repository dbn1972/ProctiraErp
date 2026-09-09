# Enterprise module development checklist

**Capability / module:** Library ops (G-916) — ISBN, holds, barcode, OPAC, fines  
**Branch / tip:** `cursor/w9-g916-library-hostel-56c3`  
**Owner / agent:** Wave 9 cloud agent  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Destiny-class circulation: ISBN import, hold shelf, barcode scan, OPAC, fine → student account  
**Dev session:** n/a (Wave 9 gap close)  
**Paired test audit:** e2e `apps/web/e2e/48-library-ops-write-smoke.spec.ts` (not executed in this environment)

---

## 0. Product contract

| Item                   | Content |
| ---------------------- | ------- |
| Capability statement   | See `PRODUCT_LIBRARY_OPS.md` |
| In scope (peer parity) | ISBN adapter, holds FIFO + expiry, barcodes, OPAC, assess-fine → fees |
| Explicit non-goals     | Live Open Library in CI; RFID; e-resources; parent-placed holds |
| Roles (RBAC)           | library manage vs read (existing campus RBAC); parent/student OPAC read |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: n/a (campus ops) |

Screen / API inventory: see PRODUCT_LIBRARY_OPS.md §5.

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence |
| ----------------------------- | ---- | -------- |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/039_library_ops_schema.sql` |
| Constraints / indexes / FKs   | ☑    | copies barcode unique per tenant; holds status check |
| Multi-board seed fixtures     | ☐    | waived — campus catalog, not board-specific |
| Domain unit/property tests    | ☑    | `library-ops.test.ts`, `library-fines.test.ts` |
| Invariants documented         | ☑    | hold only when available=0; ready expires → promote; one open fine per loan |

---

## 2. API / services

| Check                              | Done | Evidence |
| ---------------------------------- | ---- | -------- |
| Tenant middleware on all routes    | ☑    | existing library routes + new holds/isbn/opac |
| Validation + typed errors          | ☑    | TypeBox schemas |
| RBAC enforced                      | ☑    | gateway `library` resource (existing) |
| Conflict / rule failures → 409/422 | ☑    | duplicate hold ConflictError; reserved copy BusinessRuleError |
| Idempotent writes where needed     | ☑    | open-fine ConflictError on re-assess |
| Cross-tenant deny test             | ☑    | `library-ops.test.ts` tenant isolation |

---

## 3. UI (redesign)

| Screen | Empty/loading/error | Write works | Board-aware | Evidence |
| ------ | ------------------- | ----------- | ----------- | -------- |
| Catalog + ISBN lookup | ☑ | ☑ | n/a | `/library` |
| Title detail + holds | ☑ | ☑ | n/a | `/library/[id]` |
| Circulation + barcode | ☑ | ☑ | n/a | `/library/circulation` |
| Holds | ☑ | ☑ | n/a | `/library/holds` |
| Overdues + assess fine | ☑ | ☑ | n/a | `/library/overdues` |
| Fines + mark paid | ☑ | ☑ | n/a | `/library/fines` |
| OPAC (staff shell, read-only) | ☑ | read-only | n/a | `/library/opac` |

---

## 4. Cross-module integration

| Dependency | Integrated | Evidence |
| ---------- | ---------- | -------- |
| Fees (G-903) | ☑ | FeesLedgerPort → FeesService.createInvoice in domain-plugins |
| Students | ☑ | studentId on loans/holds/fines |
| Parent/student portals | ☐ | Deferred — other streams own `(parent)` / `(student)`; OPAC API + staff `/library/opac` |

---

## 5. Observability & audit

| Check | Done | Evidence |
| ----- | ---- | -------- |
| Structured logs on writes | ☐ | deferred — Fastify request logs only |
| Audit trail for sensitive mutations | ☐ | fine invoice id stored; no new audit-log events |
| Async job status (if exports) | n/a | |

---

## 6. Security & compliance

| Check | Done | Evidence |
| ----- | ---- | -------- |
| Tenant isolation | ☑ | RLS 039 + in-memory tenant filters |
| RBAC matrix documented | ☑ | PRODUCT_LIBRARY_OPS.md §6 |
| Export download auth | n/a | |
| Issued records immutable / versioned | ☐ | fines are updatable to paid |

---

## 7. Hand-off to production-ready **test** skill

| Check | Done | Evidence |
| ----- | ---- | -------- |
| Test checklist copied & filled | ☐ | not this slice (Playwright/browser not run) |
| Live write E2E (`E2E_BACKEND_READY=1`) | ☐ | spec committed, not executed |
| Desktop + tablet + mobile captures | ☐ | |
| Tip CI green | ☐ | not claimed |
| Scoreboard updated honestly | ☐ | |

---

## Exit — capability 10/10

**Verdict:** ☐ Not ready · ☑ Ready w/ waivers · ☐ **10/10 product slice**

Waivers: live Open Library, Playwright/browser, tip CI, visual captures.
