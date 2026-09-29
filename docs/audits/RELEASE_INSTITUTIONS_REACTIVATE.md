# Enterprise release / ops checklist

**Slice / PR:** Institutions reactivate  
**Branch:** `cursor/institution-reactivate-d00d`  
**Base branch:** `main`  
**Date (UTC):** 2026-09-28

## 1. Pre-merge

| Check        | Pass | Evidence                                                                     |
| ------------ | ---- | ---------------------------------------------------------------------------- |
| Tip CI       | ☐    | local live spec passed; GitHub required checks are not green on this SHA yet |
| Migrations   | ☑    | no new SQL file. Existing `institutions.status`                              |
| Providers    | ☑    | no new external provider                                                     |
| Feature flag | ☑    | none                                                                         |
| Deploy       | ☑    | api-gateway + web app image; no schema change                                |
| Rollback     | ☑    | revert the commit. Active schools stay active; no data migration to undo     |

## 2. Merge

Squash via `gh pr merge --auto --squash` after required CI (Aggregate + E2E backend-ready) is green. Main tip CI is not claimed until that run exists.
