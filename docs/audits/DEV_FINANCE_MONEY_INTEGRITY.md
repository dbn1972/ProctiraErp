# DEV — Finance money integrity (P0-07 residual)

**Capability / module:** Fees API / service money boundary  
**Branch / tip:** `cursor/finance-money-integrity-56c3`  
**Date (UTC):** 2026-09-12  
**Paired gap:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` · **P0-07** (narrow TS residual only)

---

## Scope

SQL fee columns already store **integer cents** (`amount_cents INTEGER`). Tip PARTIAL was TypeBox `Type.Number` / service `number` accepting floats at the API boundary.

This slice rejects floating-point money at the fees plugin schemas and service entrypoints (`create` plan/invoice/structure/payment/refund). Floats such as `10.5` raise `BusinessRuleError` (HTTP 400).

## Non-goals (deferred)

- BigInt / branded `Cents` rewrite
- Parent-portal fee schemas
- General ledger depth (P1)
- Other P0 packages

## Evidence

| Check                                    | Done | Evidence                                                                  |
| ---------------------------------------- | ---- | ------------------------------------------------------------------------- |
| Plugin `amountCents` → `Type.Integer`    | ☑    | `packages/backend/fees/src/fees-plugin.ts`                                |
| Service rejects non-integers             | ☑    | `packages/backend/fees/src/fees-service.ts` (+ existing structure/refund) |
| Unit: `10.5` rejected; integers accepted | ☑    | `packages/backend/fees/src/fees-service.test.ts`                          |
