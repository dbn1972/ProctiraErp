# W1-ARCH-08 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-ARCH-08 |
| Title | Notifications, communications and payments can default to sandbox/non-live behavior in production configuration. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- `provider-mode-policy.ts` + factories fail-closed in prod without mode/opt-in
- Compose uses explicit sandbox env (not silent)
- Audit: `ARCH_W1_ARCH_08_SANDBOX.md`
- Prior merge: #231

## Honest residuals

- Live adapters may still stub until INT wiring; ops must set `PROVIDER_MODE=live` for real deploys
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`. Tip CI Aggregate green is **not** claimed by this pack alone.
