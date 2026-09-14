# W1-ARCH-08 — Fail-closed production sandbox provider defaults

**Finding:** Notifications, communications and payments can default to
sandbox/non-live behavior in production configuration. Medium, partial.

**Branch:** `cursor/aud-w1-arch-08-sandbox-defaults-56c3`  
**Tip:** `fbe9796645a1ab1ddb18a99e65b82858cced97b8`  
**Date (UTC):** 2026-09-14  
**Paired tests:** `provider-mode-policy.test.ts`, notification/comms/fees honesty
tests, providers `live-adapter-honesty.test.ts`

---

## Remediation

Shared policy `@proctira/common` → `resolveProviderDeliveryMode(domain, env)`:

| Environment | Behavior |
| --- | --- |
| Non-production | Sandbox default (dev/test friendly) |
| `PROVIDER_MODE=live` | Live path (W2-INT-03 still refuses silent stub success) |
| Production + `PROVIDER_MODE=sandbox` and/or `ALLOW_SANDBOX_PROVIDERS=1` | Explicit sandbox opt-in |
| Production otherwise | **Throw at config load** (fail-closed) |

### Config loaders covered

| Surface | Factory | Package |
| --- | --- | --- |
| Notifications SMS/email/push | `createSms/Email/PushSenderFromEnv` | `@proctira/backend-notification` |
| Communications delivery | `createDeliveryAdapterFromEnv` | `@proctira/backend-communication` |
| Payments / PSP | `createPaymentAdapterFromEnv` | `@proctira/backend-fees` |
| Provider capability discovery | `listProviderCapabilities` + gateway `/providers/capabilities` | `@proctira/backend-providers` / api-gateway |

### Ops honesty

- `.env.example` documents `PROVIDER_MODE` / `ALLOW_SANDBOX_PROVIDERS`
- Root `docker-compose.yml` (api-gateway) and `docker-compose.services.yml`
  (notification-service) set explicit sandbox opt-in because compose defaults
  `NODE_ENV=production`
- Real production / k8s overlays do **not** ship the opt-in — operators must
  set `PROVIDER_MODE=live` (or knowingly opt into sandbox)

---

## Evidence

| Check | Pass | Evidence |
| --- | --- | --- |
| Prod without opt-in throws | ☑ | `provider-mode-policy.test.ts` + honesty tests |
| Explicit opt-in allows sandbox | ☑ | `ALLOW_SANDBOX_PROVIDERS=1` / `PROVIDER_MODE=sandbox` cases |
| Live mode still fail-closed on unimplemented adapters | ☑ | existing W2-INT-03 cases retained |
| Compose local stack remains bootable | ☑ | explicit env on gateway + notification-service |

---

## Residuals

1. **Live adapters still unimplemented** — `PROVIDER_MODE=live` refuses silent
   success (W2-INT-03 / G-202 / G-709). Wire Twilio/SES/FCM/PSP to clear.
2. **Auth MFA `ConsoleSmsProvider` fallback** — out of scope for this finding
   (notifications/comms/payments); still falls back to console when Twilio env
   unset (separate hardening if desired).
3. **Fees reminder sandbox path** — reminder send path remains honesty-sandbox
   inside fees service when invoked; payment *adapter* factory is gated.
4. **Production deploys** must set `PROVIDER_MODE=live` (preferred) or an
   explicit sandbox opt-in; omitting both fails boot when plugins load factories.
