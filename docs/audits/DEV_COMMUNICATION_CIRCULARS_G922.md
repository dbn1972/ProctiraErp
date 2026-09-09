# Enterprise module development checklist

**Capability / module:** Communication — WhatsApp sandbox, circulars + ack, delivery console (G-922)  
**Branch / tip:** `cursor/w9-g918-hr-comms-56c3`  
**Owner / agent:** Wave 9 gap-close agent  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Circulars with acknowledgement rate + delivery console; WhatsApp as a channel **adapter**, sandbox only  
**Dev session:** Wave 9 G-922  
**Paired test audit:** e2e `apps/web/e2e/53-communication-circulars-write-smoke.spec.ts`

---

## 0. Product contract

| Item                   | Content |
| ---------------------- | ------- |
| Capability statement   | See `PRODUCT_COMMUNICATION_G922.md` |
| In scope               | WhatsApp adapter + sandbox, circulars, acks, delivery log, retry failed |
| Explicit non-goals     | Live WhatsApp network calls, webhook receipts, media templates |
| Roles (RBAC)           | Existing `communication` resource |
| Boards impacted        | N/A |

---

## 1. Domain model (SQL-first)

| Check | Done | Evidence |
| ----- | ---- | -------- |
| Versioned SQL | ☑ | `db/sql/044_communication_circulars_schema.sql` |
| Constraints | ☑ | audience_type check; delivery status check; unique ack per recipient |
| Domain tests | ☑ | `circulars-service.test.ts`, `whatsapp-adapter.test.ts` |

Invariants: ack rate = acknowledged / recipient rows; sandbox WhatsApp never performs HTTP; retry only from `failed`.

Live WhatsApp env vars (documented, unused): `WHATSAPP_PROVIDER`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_API_BASE_URL`.

---

## 2–7.

Routes mounted inside existing `communicationPlugin` (no new `domain-plugins.ts` registrar). Persistence: pg when `DATABASE_URL` (`007` + `044`), else in-memory. Campaign/emergency send also appends delivery-log rows when the circular store is present.

**Verdict:** Ready w/ waivers (sandbox WhatsApp, no live Playwright). Not a 10/10 product slice.
