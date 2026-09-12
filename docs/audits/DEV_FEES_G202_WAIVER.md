# DEV note — G-202 live PSP waiver (Fees F4)

**Date (UTC):** 2026-09-12  
**Branch:** `cursor/fees-g202-waiver-refresh-56c3`  
**Board:** `docs/audits/WAIVER_BOARD_20260912.md`  
**Product lock:** `docs/audits/PRODUCT_FEES_BLACKBAUD_DEPTH.md` — decision **F-1 / G-202** (keep dated waiver until sandbox keys)

## Status

**G-202 remains WAIVED.** No sandbox PSP keys in this agent environment; pay/receipt stays honesty-stub / sandbox adapter only.

| Item        | Detail                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| Reason      | No sandbox PSP keys in agent env                                       |
| Residual    | Tip e2e **paid → receipt against provider** when keys are available    |
| Scorecard   | Fees stays **~8.4 PROD_WAIVED** — not a live-provider close            |
| Non-claim   | **Do not claim Blackbaud-complete** while G-202 is waived              |

## Explicit non-goals (this slice)

- No UI/API changes
- No TASKS file edit
- No live capture, webhook, or provider receipt proof fabricated without secrets
