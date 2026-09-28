# Volume 12 module QA checklist

Volume 12 §9 requires a dedicated quality checklist per module, with §3's three-axis test
matrix recorded per surface. Copy → `docs/audits/QA_<MODULE>_<YYYY-MM-DD>.md`.

The existing templates cover parts of this from other angles —
`ENTERPRISE_ACCESSIBILITY_CHECKLIST.md` for §10's a11y half, `ENTERPRISE_UX_DESIGN_REVIEW.md`
for device review — but neither carries a **browser** or **theme** column, so §3.3 and §3.4
had nowhere to be recorded. This template is the §9/§13 sheet; it does not replace them.

**Module:**  
**Owner:**  
**Branch / tip SHA:**  
**Date (UTC):**  
**Paired UX audit:**  
**Paired a11y audit:**

---

## 1. Scope (Volume 12 §9, Appendix A)

| Field                  | Value |
| ---------------------- | ----- |
| Purpose                |       |
| Supported user roles   |       |
| Critical journeys      |       |
| Critical data entities |       |
| APIs used              |       |
| Key UI screens         |       |
| Schema changes         |       |
| Release blockers       |       |

## 2. Environment matrix (§3, Appendix B)

One row per key screen. Record the **evidence**, not a tick: a spec name, a workflow run, a
capture path. `n/a` needs a reason.

| Screen | Mobile | Tablet | Desktop | Light | Dark | Chrome | Edge | Safari | Firefox |
| ------ | ------ | ------ | ------- | ----- | ---- | ------ | ---- | ------ | ------- |
|        |        |        |         |       |      |        |      |        |         |

Matrix support in this repository, so a row can cite something real:

- **§3.1 viewport classes** — all seven are swept by
  `apps/web/e2e/55-responsive-layout.spec.ts`, which runs in the `E2E Backend Ready` pull-request
  gate. Backend-free routes only; authenticated surfaces are not yet in its route list.
- **§3.2 device classes** — the `tablet-android`, `desktop` and `desktop-large` projects in
  `apps/web/e2e/qa-matrix.ts`, run weekly by `visual-regression.yml`.
- **§3.3 browser classes** — Chrome runs everywhere; `firefox`, `webkit` and `edge` are
  registered but need `PLAYWRIGHT_ALL_BROWSERS=1` and their browser binaries, and **no
  workflow sets it**. An Edge/Safari/Firefox row is a manual claim today; say so.
- **§3.4 themes** — light and dark on the anonymous auth surfaces run per pull request via
  `dark-mode-parity.spec.ts`; the ~125-route authenticated matrix runs nightly under
  `E2E_THEME_MATRIX=1`. Tenant-theme variation and high contrast have **no automation** —
  and no high-contrast mode exists in the product to test.

## 3. Functional and contract coverage (§6, §7, §8)

| Check                                                   | Pass | Evidence |
| ------------------------------------------------------- | ---- | -------- |
| Happy path, permission failure, validation, not-found   | ☐    |          |
| Tenant scoping proved negatively (cross-tenant denied)  | ☐    |          |
| Pagination / sorting / filtering                        | ☐    |          |
| Idempotency where the route mutates                     | ☐    |          |
| Audit row written for every mutation                    | ☐    |          |
| Error envelope matches the registry                     | ☐    |          |
| Schema migration applied, reversible or forward-fixable | ☐    |          |
| Loading / empty / error / retry states rendered         | ☐    |          |
| Role-aware visibility                                   | ☐    |          |

## 4. Exit criteria (§13)

| Criterion                           | Met | Evidence / waiver |
| ----------------------------------- | --- | ----------------- |
| Critical journeys pass              | ☐   |                   |
| Zero module blocking defects        | ☐   |                   |
| Zero API contract regressions       | ☐   |                   |
| Schema migrations validated         | ☐   |                   |
| Responsive smoke passed             | ☐   |                   |
| Mobile / tablet / desktop baseline  | ☐   |                   |
| Theme regressions reviewed          | ☐   |                   |
| Zero accessibility blockers         | ☐   |                   |
| Zero security-sensitive regressions | ☐   |                   |
| Zero install / upgrade regressions  | ☐   |                   |
| Documentation and evidence attached | ☐   |                   |

Severity per §13: Critical blocks release · High blocks unless explicitly approved ·
Medium may ship with documented acceptance · Low is a backlog candidate.

## 5. Findings

| ID  | Sev | Finding | Disposition |
| --- | --- | ------- | ----------- |
|     |     |         |             |

Use the repository disposition vocabulary, not "done":
`FULLY_CLOSED` · `PARTIAL` · `OPEN` · `REGRESSED` · `EXTERNALLY_UNVERIFIED`.

## 6. Sign-off

**QA claim:** ☐ Signed off · ☐ Signed off w/ waivers · ☐ Not ready

**What was behaviourally verified:**

**What remains unverified:**
