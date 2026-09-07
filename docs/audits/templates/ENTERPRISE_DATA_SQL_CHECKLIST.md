# Enterprise data / SQL certification checklist

**Module / slice:**  
**Branch / tip:**  
**Date (UTC):**  
**Environment:** <!-- local Postgres / EC3 / CI -->

Copy → `docs/audits/DATA_<MODULE>.md`. Prefer raw SQL cert paths.

---

## 1. Schema

| Artifact              | Path       | Notes |
| --------------------- | ---------- | ----- |
| Migration(s)          | `db/sql/…` |       |
| Seed(s)               |            |       |
| Invariants documented | ☐          |       |

## 2. Apply / verify (no Prisma for cert)

| Step                              | Command / evidence | Pass |
| --------------------------------- | ------------------ | ---- |
| Apply                             |                    | ☐    |
| Seed                              |                    | ☐    |
| Row counts / spot queries         |                    | ☐    |
| Multi-board profile (if required) |                    | ☐    |

## 3. Tenancy & constraints

| Check                                         | Pass | Evidence |
| --------------------------------------------- | ---- | -------- |
| Tenant scoping columns / RLS / service filter | ☐    |          |
| FK / unique / indexes for hot paths           | ☐    |          |
| Domain property tests (if any)                | ☐    |          |

## 4. Rollback

| Change | Forward fix / rollback |
| ------ | ---------------------- |
|        |                        |

## 5. Sign-off

**Data claim:** ☐ Certified · ☐ Certified w/ waivers · ☐ Not certified

**Waivers:**
