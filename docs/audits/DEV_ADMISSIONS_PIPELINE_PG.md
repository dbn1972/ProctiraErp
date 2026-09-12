# DEV — Admissions pipeline PG default (A1 / A-3)

**Capability / module:** Admissions CRM → enrol — pipeline store persistence honesty  
**Branch / tip:** `cursor/adm-pipeline-pg-56c3`  
**Date (UTC):** 2026-09-12  
**Product contract:** `docs/audits/PRODUCT_ADMISSIONS_ENROL_JOURNEY.md` (A0)  
**Peer parity:** PowerSchool / Infinite Campus admissions CRM — durable enquiry/merit/seat/offer state

---

## 0. Honest scope

| Item                   | Content                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | When `DATABASE_URL` is set, the admissions pipeline store is Postgres (`db/sql/034`), not a silent in-memory footgun for mounts that omit `pipelineStore`.                            |
| Already true before A1 | `createAdmissionsPipelineStore()` returns `PgAdmissionsPipelineStore` when `DATABASE_URL` is set; `apps/api-gateway` already passes `pipelineStore: createAdmissionsPipelineStore()`. |
| This slice             | Close the plugin default: `registration-plugin.ts` uses `createAdmissionsPipelineStore()` instead of `new InMemoryAdmissionsPipelineStore()` when the option is omitted.              |
| Explicit non-goals     | Parent offer-pay UI (A2); public apply (A3); fees netting UI; new SQL migration (034 already exists).                                                                                 |

---

## 1. Changes

| Check                                                             | Evidence                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Plugin default via factory                                        | `packages/backend/registration/src/registration-plugin.ts`                   |
| Factory policy (PG / in-memory + `assertInMemoryFallbackAllowed`) | `packages/backend/registration/src/create-registration-repository.ts`        |
| Unit isolation                                                    | `packages/backend/registration/src/create-admissions-pipeline-store.test.ts` |

---

## 2. Verdict

**A1 DONE for plugin default honesty.** Gateway was already wired; this closes alternate mounts/tests that omitted `pipelineStore`. Not a claim of full admissions 10/10 (A2/A3/A5 remain).
