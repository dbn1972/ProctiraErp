# Decision D1 — Money / currency model

**Decided by:** owner · **Status:** ACCEPTED

## Decision
1. **Default currency is INR** (Indian Rupee, ISO-4217 `INR`). All existing
   money defaults that are `USD` or implicit must become `INR`.
2. **All monetary amounts are integer minor units** (paise for INR) stored
   alongside an ISO-4217 `currency` code column. No floating-point money.
3. **Multi-currency is modelled per COUNTRY, not per tenant.** Provision the
   schema/columns and a `country → currency` resolution path so other countries
   can be added later, but **only INR is wired and seeded now**. Do not add a
   per-tenant currency setting.

## Scope of this decision
Closes the *currency* aspect of the money findings. It does NOT resolve
findings whose real blocker is a payment-provider (PSP) integration or a
separate schema-FK migration — those remain OPEN/PARTIAL with their true
blocker recorded.

### Currency-closeable under D1
- PRC-L059 (transport fee currency)
- PRC-L087 (billing plan prices: add currency + minor units, default INR)
- PRC-M349 (scholarship default USD→INR)  — currency part only
- PRC-M197 (scholarship currency default USD→INR) — currency default only
- PRC-L435 (disbursement hard-coded USD→INR) — currency part; UI lives on
  legacy SPA (see Decision D6 before touching the SPA surface)

### NOT closed by D1 (different blocker — left OPEN/PARTIAL)
- PRC-L291, PRC-M503, PRC-M246, PRC-M293 — need a real PSP/provider integration
  (sandbox↔live gating, provider_txn_id, refund PSP call). Currency is irrelevant.
- PRC-M195 — cross-tenant composite-FK hardening (schema migration batch).
- PRC-M197 dup-application/disbursement constraints — schema migration.
- PRC-M146, PRC-L574 — broad multi-client / test-authoring, unrelated to currency.

## Implementation notes
- Introduce/confirm a single canonical currency helper (ISO-4217 code + minor-unit
  integer), default `INR`, with a `country→currency` lookup (India→INR seeded).
- Replace `USD` defaults and hard-coded `INR`/`cents` with the helper.
- Keep integer minor units; add a `currency` column where a money column lacks one.
- Validation must reject non-integer or negative minor-unit amounts and unknown
  currency codes.
