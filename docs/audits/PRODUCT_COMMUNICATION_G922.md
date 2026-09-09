# Enterprise product / IA checklist

**Module / slice:** G-922 Communication (WhatsApp sandbox, circulars + ack, delivery console)  
**Branch / tip:** `cursor/w9-g918-hr-comms-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Wave 9 gap-close agent

---

## 1. Capability statement

Communications officers can publish **circulars** (title, body, audience all / roles / classes / institution, optional acknowledgement) and see an ack rate. Recipients (explicit ids for this slice) can record an ack. A **delivery-log console** lists per-channel, per-recipient rows (queued / sent / delivered / failed) with filter and retry-failed. WhatsApp is a **channel adapter interface** with a **sandbox** implementation that writes the delivery log and never calls a network provider. Live Meta/Twilio WhatsApp is waived; env var names for a future adapter are documented.

## 2. Personas & jobs

| Persona                        | Job-to-be-done                            | Success looks like                                      |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------- |
| Communications officer         | Send a circular that must be acknowledged | Circular sent; ack rate updates as recipients ack       |
| Recipient (staff actor in e2e) | Confirm they read it                      | POST ack records `acknowledgedAt`                       |
| Ops / IT                       | See why a message failed and retry        | Delivery console filter + retry failed → sandbox resent |
| Product / security             | No accidental live WhatsApp from CI       | Sandbox honesty note; no HTTP to WhatsApp APIs          |

## 3. Scope

| In scope                                                   | Non-goals                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| WhatsApp adapter interface + sandbox (logs only)           | Live WhatsApp Business / Twilio Content API                     |
| Circular entity + per-recipient ack + ack rate             | Rich targeting from live enrollments (estimator / explicit ids) |
| Delivery log console (campaign/emergency/circular sources) | Provider webhooks / delivery receipts from Meta                 |
| Retry failed (sandbox re-send, no network)                 | Template message catalogues, media, opt-in registry             |

## 4. Peer parity

| Peer capability                    | Our target this slice               |
| ---------------------------------- | ----------------------------------- |
| School circulars with read-receipt | Circular + `requiresAck` + ack rate |
| Multi-channel including WhatsApp   | Channel enum + sandbox adapter      |
| Delivery console                   | Filter + retry failed               |

## 5. Surface map

| Nav label     | Route                      | API                           | Tables / events                          | Shell |
| ------------- | -------------------------- | ----------------------------- | ---------------------------------------- | ----- |
| Communication | `/communication`           | existing campaigns/emergency  | `007`                                    | Staff |
| Circulars     | `/communication/circulars` | `/communication/circulars`    | `comms_circulars`, `comms_circular_acks` | Staff |
| Delivery log  | `/communication/delivery`  | `/communication/delivery-log` | `comms_delivery_log`                     | Staff |

## 6. Roles & tenancy (high level)

| Role                                              | Can                                     | Cannot                            |
| ------------------------------------------------- | --------------------------------------- | --------------------------------- |
| Admin / communications (`communication` resource) | Create/send circulars, view logs, retry | Cross-tenant                      |
| Other school-staff roles with communication read  | View circulars / logs if GET allowed    | Mutating send/retry unless manage |

Tenant boundary: FORCE RLS on `app.tenant_id`. Ack and delivery rows are tenant-scoped.

## 7. Success metrics / DoD

- [x] SQL 044 with FORCE RLS
- [x] Circular → send → ack → ackRate
- [x] Delivery log + retry failed
- [x] WhatsApp sandbox; live provider env vars documented, unused
- [x] E2E spec `53-communication-circulars-write-smoke.spec.ts`
- [ ] Live Playwright (deferred)

## 8. Handoff

| Next skill | Audit path                                        |
| ---------- | ------------------------------------------------- |
| Build      | `docs/audits/DEV_COMMUNICATION_CIRCULARS_G922.md` |
| UX         | not claimed                                       |
| Security   | RLS unit + tenant isolate tests                   |
| Test       | e2e spec authored; not executed                   |
| Release    | not claimed                                       |
