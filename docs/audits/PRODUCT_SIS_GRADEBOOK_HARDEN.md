# Product / IA — SIS Gradebook harden

**Module / slice:** Gradebook RBAC · cross-tenant · audit · transcript PDF-lite  
**Branch / tip:** `cursor/sis-gradebook-harden-56c3`  
**Date (UTC):** 2026-09-07  
**Owner / agent:** cloud agent

## 1. Capability statement

A teacher can upsert grades / compute GPA / queue report cards; a registrar can issue versioned official transcripts with a **PDF-lite HTML** artifact on disk; mutations leave an audit trail; Tenant B cannot read Tenant A gradebook data.

## 2. Personas & jobs

| Persona           | Job-to-be-done   | Success looks like                       |
| ----------------- | ---------------- | ---------------------------------------- |
| Teacher           | Enter grades     | PUT entries succeeds; parent role denied |
| Registrar         | Issue transcript | POST issue succeeds; teacher denied      |
| Security reviewer | Prove isolation  | Cross-tenant list empty                  |

## 3. Scope

| In scope                     | Non-goals                      |
| ---------------------------- | ------------------------------ |
| RBAC on write routes         | Crypto-sealed PDF / print shop |
| Cross-tenant service tests   | Live IdP E2E                   |
| Mutation audit log (service) | Parent grade view              |
| Transcript PDF-lite on disk  | Device-farm                    |

## 4. Success metrics / DoD

- [x] Unit tests: access + cross-tenant + audit + pdf-lite path
- [x] DEV + SEC audits updated
- [ ] Tip CI green + merge to main

## 5. Handoff

Build → this PR · Security → `SEC_SIS_GRADEBOOK.md` · Test → `SIS_GRADEBOOK_TEST_NOTES.md` · Release → after CI
