# Enterprise release / ops checklist

**Module:** Institutions detail  
**Date (UTC):** 2026-09-28  
**Base:** `main`, after PR #465 (`cursor/institutions-list-parity-34d0`) if that PR is still open.

## 1. Pre-merge

| Item                                      | Status                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| Migration `103_class_section_profile.sql` | In the branch. Apply with the rest of `db/sql`                         |
| Feature flag                              | None. Routes are the existing institution detail tabs                  |
| Seed                                      | `006` extended. Required for the live e2e story, not for empty tenants |
| Rollback                                  | Revert the PR. Drop columns from 103 if the migration was applied      |
| CI                                        | **OPEN** — not green at authoring time                                 |

## 2. Merge

Depends on #465 for the institutions shell and the expanded Sunrise seed base. This branch was cut from `cursor/institutions-list-parity-34d0` and includes the design prototype merge.

Do not claim shipped.

## 3. Rollback

Revert commits. If 103 is applied, the new columns are nullable and unused by older app builds.

## 4. Sign-off

Release disposition: **OPEN** until required checks pass on the tip.
