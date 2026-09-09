# Enterprise accessibility checklist

**Scope:** Transport ops (G-920)  
**Branch / tip:** `cursor/w9-g920-transport-56c3`  
**Date (UTC):** 2026-09-09  
**Paired UX audit:** `docs/audits/UX_TRANSPORT_OPS.md`  
**Paired test audit:** deferred

---

## 1. Automated

| Check                                   | Pass | Evidence |
| --------------------------------------- | ---- | -------- |
| axe WCAG 2.1 AA on module routes        | ☐    | not run |
| Dark-mode parity list includes routes   | ☐    | |
| Touch targets ≥44 / ≥48 mobile          | ☑    | forms use `h-11 min-h-11` |
| Contrast / icon-only lint clean for tip | ☐    | not run |

## 2. Manual

| Check                                           | Pass | Evidence |
| ----------------------------------------------- | ---- | -------- |
| Keyboard tab order / focus visible              | ☐    | not exercised |
| Dialogs / drawers focus not trapped incorrectly | n/a  | no dialogs |
| Primary CTAs have accessible names              | ☑    | Button text + icons aria-hidden |
| RTL smoke (if locale on)                        | ☐    | |
| Screen-reader spot check or waiver              | ☐    | live map has aria-label + title |

## 3. Findings

None verified in a browser.

## 4. Sign-off

**PARTIAL** — structure follows existing transport forms; axe/keyboard not run.
