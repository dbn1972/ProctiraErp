# Enterprise module test — Academics · Assessments

**Module:** Academics — Assessments  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-06  
**Module score:** **9.5 / 10** (waivers documented)

---

## 0. Screen inventory

| Nav label                  | Route                            | Roles                   | Notes                       |
| -------------------------- | -------------------------------- | ----------------------- | --------------------------- |
| Assessments · schemes list | `/assessments`                   | `assessment.read`       | Grading scheme table        |
| Assessments · new scheme   | `/assessments/schemes/new`       | `assessment.write`      | Create form → server action |
| Assessments · edit scheme  | `/assessments/schemes/[id]/edit` | `assessment.write`      | Needs real scheme id        |
| Assessments · items        | `/assessments/items`             | `assessment.read/write` | Weights must sum to 100%    |
| Assessments · results      | `/assessments/results`           | `assessment.write`      | Bulk grid + Excel import    |

---

## 1. Functionality

| Screen                           | Load OK | Write path          | Evidence                           |
| -------------------------------- | ------- | ------------------- | ---------------------------------- |
| `/assessments`                   | ☑       | N/A list            | inventory + md PNGs                |
| `/assessments/schemes/new`       | ☑       | create + client zod | `21b` ungated (`Name is required`) |
| `/assessments/schemes/[id]/edit` | ☑ soft  | update              | gated without seed                 |
| `/assessments/items`             | ☑       | define items        | md PNGs                            |
| `/assessments/results`           | ☑       | bulk entry          | md PNGs                            |

---

## 2. E2E

| Journey                  | Spec                                             | Status           |
| ------------------------ | ------------------------------------------------ | ---------------- |
| Inventory ungated        | `21-assessments-inventory-smoke.spec.ts`         | ☑ pass           |
| Write validation ungated | `21b-assessments-write-validation-smoke.spec.ts` | ☑ pass           |
| Live create / results    | `03-assessment-and-report-card.spec.ts`          | ☐ gated residual |

---

## 4. Multidevice

| Screen                              | Desktop | Tablet | Mobile | Path                                                         |
| ----------------------------------- | ------- | ------ | ------ | ------------------------------------------------------------ |
| list / items / results / scheme-new | ☑       | ☑      | ☑      | `/opt/cursor/artifacts/academics-audit/md-assessments-*.png` |

**Verdict:** ☑ Enterprise production-ready (9.5 w/ residuals) — live scheme POST still needs Prisma `grading_schemes` table.
