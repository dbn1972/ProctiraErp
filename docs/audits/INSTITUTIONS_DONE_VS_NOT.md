# Web App — Academics → Institutions (screenshot checklist)

Live verification against EC3 (`:3200` gateway / `:3201` web) with demo tenant.

Demo institution: **Kendriya Vidyalaya Proctira**

## Screenshot nav → live status

| Redesign item | Live route | Status |
|---|---|---|
| Institutions · list | `/institutions` | **DONE** |
| Institutions · profile | `/institutions/[id]` → overview | **DONE** |
| Institutions · overview tab | `/institutions/[id]/overview` | **DONE** |
| Institutions · register | `/institutions/new` | **DONE** |
| Institutions · edit | `/institutions/[id]/edit` | **DONE** |
| Institutions · classes | `/institutions/[id]/classes` | **DONE** |
| Institutions · grades | `/institutions/[id]/grades` | **DONE** |
| Institutions · infrastructure | `/institutions/[id]/infrastructure` | **DONE** |

**Result: 8 / 8 DONE**

Evidence (HTTP 200 + page markers): list shows institution + Register CTA; profile/overview show Kendriya chrome; register/edit forms load; classes/grades show Class 1 sections; infrastructure shows empty-state + Add land.

## Notes

- Infrastructure may be empty (valid empty state with Add land CTA).
- Date-string coercion hardening for institution APIs is on branch (`date-utils.ts`) and pushed to PR #1.
