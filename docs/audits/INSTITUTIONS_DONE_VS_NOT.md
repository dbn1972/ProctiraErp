# Academics — Institutions — done vs not done

Compared redesign catalog (**Web App — Academics → Institutions**) to live ProctiraERP on EC3 (gateway `:3200`, web `:3201`).

## Verdict

| Redesign nav item | Live route | Status | Evidence |
|-------------------|------------|--------|----------|
| Institutions · list | `/institutions` | **DONE** | List shows Kendriya Vidyalaya Proctira + Register CTA |
| Institutions · profile | `/institutions/[id]` → overview | **DONE** | 307 redirect to overview; profile chrome loads |
| Institutions · overview tab | `/institutions/[id]/overview` | **DONE** | H1 institution name; Overview/Students/Staff/Contact |
| Institutions · register | `/institutions/new` | **DONE** | Register institution form (Name/Code/Area) |
| Institutions · edit | `/institutions/[id]/edit` | **DONE** | Edit form prefilled with Kendriya data |
| Institutions · classes | `/institutions/[id]/classes` | **DONE** | Class sections with seeded Class 1… data |
| Institutions · grades | `/institutions/[id]/grades` | **DONE** | Grades offered with Class 1… |
| Institutions · infrastructure | `/institutions/[id]/infrastructure` | **DONE** | Empty-state UI (“No infrastructure” + Add land) |

Demo institution: `a2e96cd1-0232-4cce-97e2-00ebbfb9a374` (Kendriya Vidyalaya Proctira).

## Fixes this pass

1. **EC3 web 500** — stale Next cache still bundling old `notifications.ts` → `gateway.ts` → `next/headers` into client shell. Cleared `.next` and restarted web on `:3201`; login and institution pages return 200.
2. **Date coercion hardening** — institution API formatters now use `toIsoString`/`toIsoDate` (same Redis string-Date class of bug fixed earlier for students/staff).

## Not blocking route DONE

- Infrastructure hierarchy is empty (valid empty state; seed lands separately if demo data wanted).
- SCP deploy of date-utils to EC3 host was abandoned; change is in git for normal pull/redeploy.
