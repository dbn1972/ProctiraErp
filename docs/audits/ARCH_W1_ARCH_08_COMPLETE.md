# W1-ARCH-08 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-ARCH-08 |
| Title | Notifications, communications and payments can default to sandbox/non-live behavior in production configuration. |
| Status | **COMPLETE** (code Done-when met on `origin/main`; WhatsApp residual closed on this branch) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- `provider-mode-policy.ts` + factories fail-closed in prod without mode/opt-in
- Compose uses explicit sandbox env (not silent)
- Audit: `ARCH_W1_ARCH_08_SANDBOX.md`
- Prior merge: #231

## Residual closure — WhatsApp / circulars (this branch)

Circulars previously defaulted to raw `createSandboxWhatsAppAdapter()`, bypassing
`resolveProviderDeliveryMode`. Closed by:

- `createWhatsAppAdapter(env?)` in `packages/backend/communication/src/whatsapp-adapter.ts`
  - sandbox / non-live → sandbox adapter
  - `PROVIDER_MODE=live` without `WHATSAPP_PROVIDER` + `WHATSAPP_ACCESS_TOKEN` +
    `WHATSAPP_PHONE_NUMBER_ID` → **throw** (no silent sandbox)
  - live with those credentials → honest unimplemented live stub (throws on send)
  - production without mode/opt-in → policy throw (same as delivery/fees/notification)
- Defaults in `CircularsService` and `communication-plugin` use `createWhatsAppAdapter()`
  (injected `whatsappAdapter` still wins)
- Tests: `whatsapp-adapter.test.ts` (live no-creds fail-closed; sandbox; injection)

## Honest residuals

- Live WhatsApp / Twilio/SES/FCM/PSP adapters may still stub until INT wiring; ops must set `PROVIDER_MODE=live` (+ WhatsApp creds for WA) for real deploys
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`. Tip CI Aggregate green is **not** claimed by this pack alone. WhatsApp circular default residual closed on branch `cursor/w1-arch-08-provider-policy-56c3`.
