# Decision register — gaps that need an owner call, not code

Generated from `CANONICAL_LEDGER.csv`. These are OPEN/PARTIAL findings whose
wave notes say they are blocked on a decision (owner / legal / product / finance
/ platform), not on engineering effort. An agent cannot close them without the
decision. Each group below states the decision you need to make; once you
decide, the affected findings become codeable and move into the normal batch
queue.

> Re-triage note: some findings were parked as "owner decision" in the wave
> notes but are actually plain engineering work (writing tests, fixing an
> in-memory test fixture). Those are pulled OUT of this register into
> "Re-triage → codeable" at the bottom and will be worked as normal batches.

---

## 1. Money / currency model — 11 findings  (FINANCE decision)
Examples: PRC-L087 (billing plan prices carry no currency; cents hard-wired),
PRC-L059 (transport fee amount validation client-only), PRC-L291 (fee-reminder
audit table hard-checks mode='sandbox').
**Decision needed:** What is the canonical money model? (a) single platform
currency, or multi-currency per tenant? (b) are amounts always integer minor
units (cents) with a currency code column? Answer sets the schema + validation
for all fee/billing findings.

## 2. Role / permission catalogue + realm — 14 + 5 findings  (PLATFORM/IdP decision)
Examples: PRC-L174/L391/M237/M521/L276/L347 (role names used in code that do
NOT exist in the shipped Keycloak realm), PRC-L202 (UI authz on unsigned JWT).
**Decision needed:** Who owns the authoritative role catalogue, and will the
Keycloak realm export be extended to include the domain roles the code already
references (exam-officer, warden, bursar, transport roles, etc.)? Until the
realm defines them, these role gates can't be made real.

## 3. Timezone / locale policy — 3 findings  (PRODUCT decision)
Examples: PRC-L426 (audit/schedule timestamps formatted in server local time),
PRC-L596 (WelcomeBanner uses browser locale at render).
**Decision needed:** What is the source of truth for a tenant's timezone, and
should all user-facing timestamps render in tenant TZ (not server/browser)?

## 4. i18n scope — 3 findings  (PRODUCT decision)
Examples: PRC-L195 (hard-coded English strings across ui widgets).
**Decision needed:** Which surfaces must be localized now vs later, and what is
the target locale set? Drives how much string-externalization work to do.

## 5. Legal / counsel-supplied content — 9 findings  (LEGAL decision)
Examples: PRC-L262 (DPDP privacy/terms copy), PRC-M214 (DPDP erasure/
anonymisation), PRC-M203 (legal-hold guard), PRC-M623 (PHI retention).
**Decision needed:** Counsel must supply the actual privacy/retention/erasure
policy text and rules. These MUST NOT be fabricated by an agent; code can wire
up whatever policy legal provides.

## 6. Legacy SPA / tooling removal — 45 findings  (ARCHITECTURE decision)
Examples: PRC-L414/L415 (legacy Vite App.tsx + dead SPA feature pages),
PRC-L078 (FeatureFlagsProvider never fed entitlements), PRC-L441 (legacy
vite.config.ts). Many "weak client gating" findings live in this dead SPA.
**Decision needed:** Delete the unmounted legacy Vite SPA entirely? Most of
these findings evaporate if the dead code is removed; they are unverifiable
while it stays. One decision retires a large block.

## 7. Product flag / scope — 9 findings  (PRODUCT decision)
Examples: PRC-L038 (demo/placeholder surfaces), PRC-M147 (fabricated dashboard
radar score), PRC-L067 ('working days' ignores holidays/Saturday schools).
**Decision needed:** For each placeholder/demo surface — hide behind a feature
flag until the backend ships, or build it now? And confirm business rules
(e.g. working-days calendar).

## 8. Caching policy — 1 finding  (PLATFORM decision)
PRC-L266: authenticated reads use Next Data Cache revalidate 30/60.
**Decision needed:** no-store for authenticated reads, or per-tenant/user
cache-tags? Broad policy across many reads.

## 9. Data-scoping / validation ownership — ~15 findings  (PRODUCT/PLATFORM)
Examples: PRC-L118 (hostel institutionId filter is a no-op), PRC-L120
(configurable facility condition options), PRC-M008 (attendance % computed 3
ways). **Decision needed:** confirm the intended scoping/business semantics so
the fix matches intent rather than guessing.

---

## Re-triage → codeable (NOT real decisions) — ~16 findings
Parked as "owner" but actually plain engineering (tests / fixtures):
PRC-L228 (gradebook component tests), PRC-L253 (sw.js test harness), PRC-L476
(in-memory Prisma look-alike divergence), and similar. These are being pulled
back into the normal codeable batch queue.

---

### How to use this
Answer the groups above (even a one-line call per group). Each answer unblocks
its findings, which then move into the batch queue with the decision recorded
in the finding's ledger `notes`. Groups 1, 2, 5, and 6 unblock the most findings
per decision — those are the highest-leverage calls.
