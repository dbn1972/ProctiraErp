# Communication — screen-by-screen test (Sunrise demo tenant)

**Branch:** `cursor/screen-test-reports-comms-c645`  
**Date (UTC):** 2026-09-27  
**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** no circulars, campaigns, delivery rows, or emergency blasts. Students and staff exist (Aarav Mehta, Diya Sharma, Vivaan Patel, Ananya Reddy, Rohan Mehta; Sunil Rao, Priya Sharma, Neha Verma).  
**Session:** HS256 staff cookie, role `SUPER_ADMIN`, subject `neha.verma`.  
**Stack:** Postgres 16, api-gateway `:3000`, Next.js dev `:3001`.

This is a route walk. It is not a production-ready or 10/10 claim. No circular, campaign, or emergency blast was submitted. WhatsApp stays on the sandbox adapter.

## Aggregate

| Result  | Count |
| ------- | ----: |
| PASS    |     8 |
| FAIL    |     0 |
| BLOCKED |     0 |
| SKIPPED |     0 |

## Route table

| Route                           | Primary action             | Result   | What the screen showed                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/communication`                | Open the home              | **PASS** | Cards for Campaigns, Emergency, Circulars, and Delivery log. Copy states WhatsApp is sandbox-only.                                                                                                                                                                |
| `/communication/circulars`      | List circulars             | **PASS** | Honest empty: “No circulars yet. Create a circular to notify staff or families.”                                                                                                                                                                                  |
| `/communication/circulars/new`  | Open the new circular form | **PASS** | Tip re-walk after the picker change: “Add recipient” and named options `SPS-NID-001 · Aarav Mehta`, Diya Sharma, Vivaan Patel, Ananya Reddy, Rohan Mehta, Principal · Sunil Rao, Class teacher · Priya Sharma, Accounts · Neha Verma. The form was not submitted. |
| `/communication/circulars/[id]` | Open one circular          | **PASS** | Missing id renders “Page not found”. No seeded circular to acknowledge. Ack rows now resolve a recipient id to a name when a circular exists.                                                                                                                     |
| `/communication/campaigns`      | List campaigns             | **PASS** | Honest empty: “No campaigns yet.”                                                                                                                                                                                                                                 |
| `/communication/campaigns/new`  | Open the new campaign form | **PASS** | Name, channels (Email, SMS, Push, In app), audience scope, preview, and create. Hostel and route scopes use named pickers. Nothing was created. Preview was not submitted.                                                                                        |
| `/communication/delivery`       | Open delivery status       | **PASS** | Honest empty: “No delivery log rows for this filter.” Channel and status filters are present.                                                                                                                                                                     |
| `/communication/emergency`      | Open compose               | **PASS** | Draft form with reason, channels, and the second-confirmer warning. “No emergency blasts yet.” Draft was not submitted.                                                                                                                                           |

## UX fixes in this walk

- Circular recipients and audience targets are chosen by name, not pasted ids.
- Campaign hostel and route fields no longer say “UUID”.
- Channel checkboxes use plain labels (In app, WhatsApp, Email).
- Delivery log and circular acknowledgements use `resolveEntityLabel`.

## Residual

- Send, ack, and emergency confirm were not clicked. Sandbox send already uses `ConfirmActionDialog` (`send-campaign-confirm`) when a draft campaign exists.
- No circular was created, so the name picker was not submitted.
