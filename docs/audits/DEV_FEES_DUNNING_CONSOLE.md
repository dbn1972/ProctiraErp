# Enterprise module development — Fees dunning / reminder console (F2)

**Capability / module:** Fees · dunning / overdue reminder operator console  
**Branch / tip:** `cursor/fees-dunning-console-56c3`  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Blackbaud Tuition–style collections reminders (operator feed, suppressions, send audit)  
**Product lock:** `docs/audits/PRODUCT_FEES_BLACKBAUD_DEPTH.md`  
**Tasks:** `docs/plans/TASKS_FEES_ADMISSIONS_WORLD_CLASS_GAPS.md` (Slice F2 — parent owns checklist updates)

## 0. Product contract

| Item                 | Content                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | Fee officers can open `/fees/dunning`, review the overdue reminder feed, add/remove suppressions, and send sandbox email/SMS reminders with an audit trail — without claiming live Twilio/SES. |
| In scope             | Staff console UI; overdue feed wire; suppressions + send/audit APIs; hub card; ungated page smoke; a11y/dark/touch route lists; G-709 honesty banner                                           |
| Explicit non-goals   | Live Twilio/SES/FCM (G-709); scholarship netting (F1); recon/parent instalments (F3); durable SQL for suppressions/audit (process-local sandbox store); Blackbaud-complete claim               |
| Roles                | Staff with fees session + tenant JWT; parents cannot dunning-send                                                                                                                              |

Screen / API inventory:

| Nav / surface       | Route           | API                                                                                          | Tables / events                                       | PII                  |
| ------------------- | --------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------- |
| Dunning / reminders | `/fees/dunning` | `GET /fees/reminders/overdue`; suppressions CRUD; `POST /fees/reminders/send`; `GET …/audit` | overdue feed; process-local suppressions + send audit | studentId, invoiceId |

## 1. Domain model

No new SQL. Suppressions and send audits live on `FeesService` process memory (sandbox console). Unit proof: `packages/backend/fees/src/reminder-dunning.test.ts`.

## 2. API / services

| Check                        | Done | Evidence                                                            |
| ---------------------------- | ---- | ------------------------------------------------------------------- |
| Overdue feed already mounted | ☑    | `fees-plugin.ts` `GET ${prefix}/reminders/overdue` (+ `suppressed`) |
| Suppressions + send + audit  | ☑    | `POST/GET/DELETE …/suppressions`, `POST …/send`, `GET …/audit`      |
| Sandbox honesty (no Twilio)  | ☑    | `FEES_REMINDER_SANDBOX_HONESTY_NOTE`; mode always `sandbox`         |
| Tenant-scoped                | ☑    | service filters by `tenantId`; unit isolation for suppressions      |
| Client helpers               | ☑    | `apps/web/src/lib/api/fees.ts` reminder helpers                     |

## 3. UI

| Screen          | Empty/loading/error                          | Write                                        | Evidence              |
| --------------- | -------------------------------------------- | -------------------------------------------- | --------------------- |
| `/fees/dunning` | Empty overdue copy; error alert; audit empty | Send / add-remove suppression server actions | `dunning-console.tsx` |
| Fees hub        | —                                            | Link `data-testid=open-dunning`              | `fees/page.tsx`       |

Honesty: amber sandbox banner; G-709 not claimed.

## 4–6. Integration / observability / residual

- Cadence + min overdue days on send; suppressed rows skipped.
- Audit stores sandbox `messageId`s for operator proof.
- Residual: tip CI on merge; UX designer captures; durable suppression store if product later requires restart-safe memory.

## Exit (this slice)

- [x] Staff page + API wire (feed + suppressions + sandbox send/audit)
- [x] Ungated e2e page smoke + a11y/dark/touch + page matrix
- [x] DEV note (this file)
- [ ] Tip CI green on merge commit (release gate — not claimed here)
