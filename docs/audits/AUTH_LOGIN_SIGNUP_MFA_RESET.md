# Enterprise module test — Auth

**Module:** Auth (public identity)  
**Branch / tip:** `main` @ `9f778e3` (Auth #8–#11; captures on tip)  
**Environment:** tip `main` carve-out (headless cloud agent)  
**Date (UTC):** 2026-09-05  
**Tip CI:** https://github.com/dbn1972/ProctiraErp/actions/runs/33968548810 — **success**

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

> **PR #1 note:** `cursor/cloud-agent-1788494670027-3janc` (PR #1) is a mega
> Phase-2 schema/mobile branch that **conflicts** with tip `main` and is
> **not** mergeable as-is. Auth UI enterprise equivalent landed as **PR #8**
> (+ tip Prettier fix **PR #9**). PR #1 should be closed or rebased as a
> separate non-Auth schema effort.

---

## 0. Screen inventory

| Nav label       | Route              | Roles                 | PII/PHI              | Notes                          |
| --------------- | ------------------ | --------------------- | -------------------- | ------------------------------ |
| Login / sign-in | `/login`           | anonymous             | PII (email/password) | App Router `(auth)/login`      |
| Sign up         | `/signup`          | anonymous             | PII                  | Middleware `PUBLIC_PATHS`      |
| Forgot password | `/forgot-password` | anonymous             | PII (email)          | Non-disclosing UX              |
| Reset password  | `/reset-password`  | anonymous + token     | PII                  | Token in query                 |
| MFA verify      | `/mfa`             | anonymous + challenge | PII (OTP)            |                                |
| Logout          | `/logout`          | session end           | session cookies      | Redirects → `/api/auth/logout` |
| OAuth callback  | `/oauth/callback`  | anonymous OAuth       | OAuth code/state     | Forwards → API callback        |

---

## 1. Functionality

| Screen            | Load OK | Empty/loading/error | Write path or N/A | Evidence                                              |
| ----------------- | ------- | ------------------- | ----------------- | ----------------------------------------------------- |
| `/login`          | ☑       | ☑                   | Sign-in write     | `e2e/auth/signin-local.spec.ts` (mocked)              |
| `/signup`         | ☑       | ☑                   | Sign-up write     | `e2e/auth/signup.spec.ts` (mocked)                    |
| `/forgot-password`| ☑       | ☑                   | Request reset     | `e2e/auth/forgot-password.spec.ts`                    |
| `/reset-password` | ☑       | ☑                   | Reset write       | `e2e/auth/reset-password.spec.ts`                     |
| `/mfa`            | ☑       | ☑                   | Verify write      | `e2e/auth/mfa-verify.spec.ts` + keyboard unit         |
| `/logout`         | ☑       | N/A                 | Session clear     | `e2e/auth/logout-oauth-redirect.spec.ts` (3/3 pass)   |
| `/oauth/callback` | ☑       | error → login       | N/A (BFF)         | same smoke + API `sanitizeReturnTo`                   |

**Fixes shipped**
- `sanitizeReturnTo` helper + unit tests (`return-to.test.ts` — 4/4)
- Wired into login / signup / MFA forms and OAuth callback API
- Middleware login redirect only accepts same-origin relative `returnTo`
- Property test `PUBLIC_PATHS` synced to include `/signup`
- Extended axe / touch / dark / capture for Auth screens
- Always-on logout + OAuth + open-redirect Playwright smokes

---

## 2. E2E (Playwright)

| Journey                   | Spec file                                | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence                               |
| ------------------------- | ---------------------------------------- | ---------------------------- | ------- | ------ | -------------------------------------- |
| Mocked auth suite         | `e2e/auth/*.spec.ts`                     | N/A (always on)              | ☑       | —      | Existing + tip CI                      |
| Logout / OAuth / redirect | `e2e/auth/logout-oauth-redirect.spec.ts` | N/A                          | ☑       | —      | 3/3 headless chromium on tip           |
| Live login/logout         | —                                        | ☐ waived                     | —       | —      | No auth-service in agent; waiver below |

---

## 3. UX / a11y

| Check                          | Pass | Evidence                                         |
| ------------------------------ | ---- | ------------------------------------------------ |
| axe WCAG 2.1 AA on Auth routes | ☑    | `e2e/a11y-axe.spec.ts` (+ forgot/reset/mfa)      |
| Dark mode parity (Auth public) | ☑    | `e2e/dark-mode-parity.spec.ts` Auth block        |
| Touch targets ≥44px            | ☑    | `e2e/touch-target-minimum.spec.ts` PUBLIC_ROUTES |
| Keyboard / focus (MFA)         | ☑    | `mfa-form.keyboard.test.tsx` (10/10)             |
| Auth link contrast             | ☑    | `text-primary` (not low-contrast accent teal)    |

---

## 4. Multidevice captures

Captured on tip `main` @ `6c9e391` via headless Playwright against local Next.js
(`localhost:3001`), viewports **1440 / 834 / 390**. Pack lives outside the repo:

`/opt/cursor/artifacts/auth-audit/{route}-{viewport}.png`

| Screen            | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path (prefix)                                      |
| ----------------- | ------------ | ---------- | ---------- | ----------------------------------------------------------- |
| `/login`          | ☑            | ☑          | ☑          | `.../auth-audit/login-{1440,834,390}.png`                   |
| `/signup`         | ☑            | ☑          | ☑          | `.../auth-audit/signup-{1440,834,390}.png`                  |
| `/forgot-password`| ☑            | ☑          | ☑          | `.../auth-audit/forgot-password-{1440,834,390}.png`         |
| `/reset-password` | ☑            | ☑          | ☑          | `.../auth-audit/reset-password-{1440,834,390}.png`          |
| `/mfa`            | ☑            | ☑          | ☑          | `.../auth-audit/mfa-{1440,834,390}.png`                     |
| `/logout`         | ☑            | ☑          | ☑          | `.../auth-audit/logout-{1440,834,390}.png` → `/login`       |
| `/oauth/callback` | ☑            | ☑          | ☑          | `.../auth-audit/oauth-callback-{1440,834,390}.png` → login + error |

Walkthrough key copies (desktop/mobile):  
`/opt/cursor/artifacts/auth_login_desktop_1440.png`,  
`auth_signup_desktop_1440.png`, `auth_mfa_desktop_1440.png`,  
`auth_forgot_password_desktop_1440.png`, `auth_login_mobile_390.png`.

Horizontal scroll / clipped CTA: none observed on Auth public forms in this pack.

---

## 5. Security

| Check                                | Pass | Evidence                                   |
| ------------------------------------ | ---- | ------------------------------------------ |
| Unauthenticated dashboard → `/login` | ☑    | middleware                                 |
| Open-redirect `returnTo` blocked     | ☑    | `sanitizeReturnTo` + smoke (3/3)           |
| `/signup` publicly reachable         | ☑    | middleware `PUBLIC_PATHS`                  |
| httpOnly session cookies             | ☑    | `lib/auth/cookies.ts`                      |
| Cross-tenant IDOR                    | N/A  | Auth is identity, not tenant resource CRUD |
| No secrets in git artifacts          | ☑    |                                            |

---

## 6. CI / production gates

| Gate                      | Pass | Link / SHA                                                              |
| ------------------------- | ---- | ----------------------------------------------------------------------- |
| Lint / typecheck / unit   | ☑    | tip `5fbebe3` — [CI run 33968548810](https://github.com/dbn1972/ProctiraErp/actions/runs/33968548810) |
| Auth unit (`return-to`)   | ☑    | vitest 4/4                                                              |
| DoD / Lighthouse `/login` | ☑    | same tip CI (DoD + Lighthouse Gate success)                             |
| Deploy Build Images       | ☐    | Infra: empty `REGISTRY` / docker login — not Auth code (pre-existing)   |

---

## 7. Residual risks / waivers

| Item                                                                   | Risk                                                       | Owner                      | Waiver date  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------- | ------------ |
| Live `E2E_BACKEND_READY` Auth happy/negative against real auth-service | Medium — mocked suite covers wiring; live IdP not in agent | cloud-agent                | 2026-09-05   |
| CSRF on cookie-authenticated POSTs                                     | Medium — SameSite=lax cookies; no CSRF token yet           | platform                   | 2026-09-05   |
| Middleware JWT decode-only (no sig verify)                             | Known — gateway verifies                                   | platform                   | pre-existing |
| PR #1 mega-branch not merged                                           | Accepted — Auth equivalent = PR #8; #1 CONFLICTING         | close or rebase separately | 2026-09-05   |
| Deploy registry secrets                                                | Infra — `REGISTRY` empty on Deploy                         | platform                   | 2026-09-05   |
| Auth multidevice PNG capture pack                                      | Closed — 21 PNGs under `/opt/cursor/artifacts/auth-audit/` | cloud-agent                | 2026-09-05   |

---

## Done criteria

- [x] Pillars evidence **or** dated waivers above
- [x] Tip CI green (Lint/typecheck/unit/DoD/Lighthouse/bundle/tenant) — run 33968548810
- [x] Auth equivalent merged to main (PR #8 + tip fix #9)
- [x] Walkthrough PNG pack — 21 PNGs under `/opt/cursor/artifacts/auth-audit/` (desktop/tablet/mobile)
- [x] Session state set to `complete` via hooks helper (Auth + prior modules)

**Verdict:** ☐ Not ready · ☑ Ready with waivers · ☐ Enterprise production-ready
