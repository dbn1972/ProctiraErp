# Enterprise release / ops checklist

**Slice / PR:**  
**Branch / tip SHA:**  
**Base branch:**  
**Date (UTC):**

Copy → `docs/audits/RELEASE_<SLICE>.md`.

---

## 1. Pre-merge

| Check                                               | Pass | Evidence |
| --------------------------------------------------- | ---- | -------- |
| Tip CI all required checks SUCCESS on **this** SHA  | ☐    |          |
| Migrations listed + apply order                     | ☐    |          |
| External providers: sandbox honesty or live secrets | ☐    |          |
| Feature flags / kill switches (if any)              | ☐    |          |
| Deploy path understood (or N/A docs-only)           | ☐    |          |
| No secrets / large binary dumps in commit           | ☐    |          |
| Scoreboard / audits updated                         | ☐    |          |

## 2. Merge

| Action                               | Done |
| ------------------------------------ | ---- |
| PR ready (not stale draft)           | ☐    |
| Merge strategy noted (squash/rebase) | ☐    |
| Main tip CI watched after merge      | ☐    |

## 3. Rollback

| Scenario        | Plan / owner |
| --------------- | ------------ |
| App regression  |              |
| Bad migration   |              |
| Provider outage |              |

## 4. Sign-off

**Ship claim:** ☐ Ready · ☐ Ready w/ waivers · ☐ Not ready

**Waivers:**
