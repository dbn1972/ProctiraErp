# Enterprise security & tenancy checklist

**Module / slice:**  
**Branch / tip:**  
**Date (UTC):**  
**Data classes:** <!-- public / PII / PHI / financial -->  
**Paired test audit:**

Copy → `docs/audits/SEC_<MODULE>.md`.

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
|             |       |       |            |       |

---

## 1. Controls

| Check                                   | Pass | Evidence |
| --------------------------------------- | ---- | -------- |
| Unauthenticated → sign-in / 401         | ☐    |          |
| RBAC deny / hide                        | ☐    |          |
| Cross-tenant IDOR blocked (API)         | ☐    |          |
| Cross-tenant IDOR blocked (UI)          | ☐    |          |
| Write audit events (money/consent/PHI)  | ☐    |          |
| No secrets/tokens in git or client logs | ☐    |          |
| Tenant isolation suite cited/run        | ☐    |          |
| Input validation / abuse basics         | ☐    |          |

---

## 2. Findings

### P0

| ID  | Finding | Fix |
| --- | ------- | --- |
|     |         |     |

### P1 / P2

| ID  | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
|     |     |         |              |

---

## 3. Sign-off

| Claim                            | Status |
| -------------------------------- | ------ |
| P0 cleared                       | ☐      |
| P1 cleared or waived             | ☐      |
| Safe to merge from security view | ☐      |

**Residual risks:**
