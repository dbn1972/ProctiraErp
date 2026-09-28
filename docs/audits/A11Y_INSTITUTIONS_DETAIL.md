# Enterprise accessibility checklist

**Module:** Institutions detail  
**Date (UTC):** 2026-09-28

## 1. Automated

No axe run in this session. Disposition: **EXTERNALLY_UNVERIFIED**.

## 2. Manual

| Check | Evidence | Disposition |
| ----- | -------- | ----------- |
| Names on controls | e2e finds "Withdraw Aarav Mehta" after hydration | **PARTIAL** |
| Dialog | `ConfirmActionDialog` title and cancel | **PARTIAL** — keyboard trap not re-tested here |
| Tables | `aria-label` on class and grade tables | **PARTIAL** |
| Status not colour-only | Published/Draft/Archived and Enrolled/Withdrawn text | **FULLY_CLOSED** for those pills |
| RTL / contrast | Not measured on these five screens this session | **OPEN** |

## 3. Findings

Withdraw buttons set `data-hydrated` so the confirm dialog is not clicked before the client handler attaches.

## 4. Sign-off

Not an accessibility sign-off.
