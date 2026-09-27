# Enterprise security & tenancy checklist

**Module / slice:** Transcript signing key (student import is out of scope for this file)  
**Branch / tip:** `cursor/student-import-transcript-fix-a176`  
**Date (UTC):** 2026-09-27  
**Data classes:** student academic record (PII on the transcript artifact); signing material is a secret  
**Paired test audit:** unit tests in `packages/backend/gradebook/src/signed-download.test.ts` and `routes.test.ts`

This is a defect fix, not a full gradebook tenancy certification.

---

## 0. Inventory

| Route / API                         | AuthN                  | AuthZ                              | Data class            | Notes                                             |
| ----------------------------------- | ---------------------- | ---------------------------------- | --------------------- | ------------------------------------------------- |
| `POST /gradebook/transcripts/issue` | Gateway JWT (existing) | `transcript.issue` registrar roles | PII transcript + HMAC | Missing production key returns 503, no row insert |

---

## 1. Controls

| Check                                   | Pass | Evidence                                                                                                                                                                 |
| --------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unauthenticated → sign-in / 401         | ☐    | Unchanged; not re-proved in this slice                                                                                                                                   |
| RBAC deny / hide                        | ☐    | Existing registrar gate unchanged                                                                                                                                        |
| Cross-tenant IDOR blocked (API)         | ☐    | Unchanged tenant scope on issue                                                                                                                                          |
| Cross-tenant IDOR blocked (UI)          | ☐    | Not exercised here                                                                                                                                                       |
| Write audit events (money/consent/PHI)  | ☐    | Existing `transcript.issue` audit still runs only after a successful sign                                                                                                |
| No secrets/tokens in git or client logs | ☑    | Ephemeral key is `randomBytes` in memory. Log payload is env names, `kmsKeyRef`, and `keyId` only. Tests assert JWT material and HMAC bytes are absent from the warning. |
| Tenant isolation suite cited/run        | ☐    | Not part of this change                                                                                                                                                  |
| Input validation / abuse basics         | ☑    | Production refuses unset secret and refuses JWT / board-export reuse (existing checks kept)                                                                              |

---

## 2. Findings

### P0

| ID  | Finding                                                                | Fix                                                                                        |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| —   | No committed private key. Production does not invent signing material. | `prepareTranscriptSigningAtStartup` returns without generating when `NODE_ENV=production`. |

### P1

| ID  | Finding                                                        | Fix                                                                                                                                                      |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | Non-production issuances can be signed with a non-durable key. | Metadata uses `dev:ephemeral-in-memory` so they are distinguishable from KMS-backed issues. Warning tells operators not to use them as official records. |

---

## 3. Waiver / residual

Ephemeral signatures are valid only inside the process that created them. A restart invalidates verification of those rows unless the same secret is later configured. That is accepted for local, test, and CI only.
