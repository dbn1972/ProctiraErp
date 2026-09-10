# Enterprise UX design review

**Scope:** Transport ops (G-920)  
**Branch / tip:** `cursor/w9-g920-transport-56c3`  
**Date (UTC):** 2026-09-09  
**Reviewer / agent:** Cloud agent  
**Paired test audit:** deferred (no Playwright run / captures in this worktree)  
**Captures root:** none — **not UX-reviewed from pixels**

---

## 0. Inventory

| Screen      | Route                          | Desktop | Tablet | Mobile | Notes                           |
| ----------- | ------------------------------ | ------- | ------ | ------ | ------------------------------- |
| Overview    | `/transport`                   | ☐       | ☐      | ☐      | extra cards added; not captured |
| Route stops | `/transport/routes/[id]/stops` | ☐       | ☐      | ☐      |                                 |
| Live map    | `/transport/live`              | ☐       | ☐      | ☐      | SVG, not a map SDK              |
| Attendance  | `/transport/attendance`        | ☐       | ☐      | ☐      |                                 |
| Alerts      | `/transport/alerts`            | ☐       | ☐      | ☐      |                                 |
| Fees        | `/transport/fees`              | ☐       | ☐      | ☐      |                                 |

---

## 1. Rubric scores (1–10)

Not scored — no PNG captures viewed.

**Module UX score (avg):** n/a (not claimed)

---

## 2. Findings

### P0 (must fix)

None from code review; visual QA not run.

### P1

| ID   | Screen     | Finding                                         | Fix / evidence                                    |
| ---- | ---------- | ----------------------------------------------- | ------------------------------------------------- |
| UX-1 | Live map   | SVG projection is a substitute for a slippy map | Documented; OSM deep links                        |
| UX-2 | Attendance | Trip query is form POST, not URL-driven load    | PARTIAL — summary needs route/date query for list |

---

## 4. Sign-off

**Verdict:** PARTIAL — layout follows existing transport cards; **not** “UX reviewed”.
