# PRODUCT — Enterprise P0/P1/P2 gap program

**Date (UTC):** 2026-09-12  
**Owner:** Product / platform  
**Task file:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md`  
**Skills:** enterprise-product-ia (this) → module-development → …

## 1. Capability statement

Operators can run ProctiraERP as a **tenant-safe, durable, money-correct, PHI-aware** school ERP: every mutating API is authorization-proven, production paths do not silently use memory, finance posts in integer currency with recon, health data has field-level and break-glass controls, and deploy/backup evidence exists. Depth modules (LMS, hostel, …) expand only after P0 is clear.

## 2. Personas

| Persona                   | Job                                          |
| ------------------------- | -------------------------------------------- |
| Platform / security owner | Prove deny-by-default authZ, tenancy, crypto |
| Finance controller        | Trust ledger, sequences, recon               |
| Registrar / academic ops  | Complete enrollment & progression UI         |
| Guardian                  | See only linked children; consent-scoped     |
| Nurse / counsellor        | PHI with break-glass accountability          |
| SRE                       | Helm path, probes, backup/restore evidence   |

## 3. Scope

| In scope (P0)                                              | Non-goals now                          |
| ---------------------------------------------------------- | -------------------------------------- |
| AuthZ matrix, auth shell, relationship authZ               | Live IdP/PSP/Twilio secrets            |
| Kill memory fallback; durable workers spine                | Full LMS/alumni/canteen depth (P2)     |
| Money integrity; attendance RLS; health PHI                | Multi-entity consolidation             |
| ETL persist + probes; devportal crypto; Helm; backup drill | Claiming Fees/Admissions peer-complete |

## 4. Peer parity (named)

| Peer theme                            | Target this program                |
| ------------------------------------- | ---------------------------------- |
| PowerSchool / Infinite Campus tenancy | Tenant + relationship deny proofs  |
| Workday/Banner money                  | Integer money + transactional post |
| Ed-health privacy                     | Field ACL + break-glass audit      |

## 5. Success / DoD

- [ ] All P0 slices DONE or dated WAIVER
- [ ] Tip CI green on last P0 merge
- [ ] No “world-class complete” claim while any P0 OPEN
- [x] First pack closed (2026-09-12): P0-02, P0-05, P0-08, P0-11, P0-12
- [x] Second pack closed (2026-09-12): P0-01, P0-04, P0-06, P0-10

## 6. Handoff

Build slices per `TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` §1 packs A–E. Next: P0-03 / 09 / 13 (± P0-07) in parallel.
