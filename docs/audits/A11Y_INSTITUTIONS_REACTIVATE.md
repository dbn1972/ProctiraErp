# Enterprise accessibility checklist

**Scope:** Institutions reactivate confirm dialog  
**Branch / tip:** `cursor/institution-reactivate-d00d`  
**Date (UTC):** 2026-09-28

## 1. Automated

| Check | Pass | Evidence |
| --- | --- | --- |
| axe on `/institutions` | ☐ | existing `a11y-axe.spec.ts` covers the list; not re-run live in this session |
| Touch | ☐ | overflow trigger keeps `min-h-6` matching the existing row actions (24px icon button, same as deactivate) |
| Named controls | ☑ | menu item name `Reactivate`; dialog title; reason label; confirm `data-testid` |

## 2. Manual

| Check | Pass | Evidence |
| --- | --- | --- |
| Keyboard | ☑ | Playwright spec focuses the overflow trigger, ArrowDown, Enter, reason field, confirm Enter |
| Dialog | ☑ | `ConfirmActionDialog` (Radix Dialog) with cancel and confirm |
| Toast | ☑ | `role="status"` success message |
| Screen reader | ☐ | no screen-reader session in this environment — waiver: dialog uses title, description, and a labelled reason field |

## 3. Findings

P2: row icon buttons stay 32px, matching deactivate, under a 44px touch target. Not introduced by this slice.
