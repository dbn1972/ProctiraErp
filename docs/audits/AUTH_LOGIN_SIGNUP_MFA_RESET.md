# Enterprise module test — Auth

**Module:** Auth (public identity)  
**Branch / tip:** `cursor/auth-enterprise-e2e-56c3`  
**Environment:** tip `main` carve-out (headless cloud agent)  
**Date (UTC):** 2026-09-05  

Copied from `docs/audits/templates/ENTERPRISE_MODULE_TEST_CHECKLIST.md`.

> **PR #1 note:** `cursor/cloud-agent-1788494670027-3janc` (PR #1) is a mega
> Phase-2 schema/mobile branch that **conflicts** with tip `main` and is
> **not** mergeable as-is. Auth UI + mocked e2e already live on `main`.
> This audit covers tip-main Auth with enterprise hardening (open-redirect
> guard + coverage extensions). PR #1 should be closed or rebased as a
> separate non-Auth schema effort.

---

## 0. Screen inventory

| Nav label | Route | Roles | PII/PHI | Notes |
| --- | --- | --- | --- | --- |
| Login / sign-in | `/login` | anonymous | PII (email/password) | App Router `(auth)/login` |
| Sign up | `/signup` | anonymous | PII | Middleware `PUBLIC_PATHS` |
| Forgot password | `/forgot-password` | anonymous | PII (email) | Non-disclosing UX |
| Reset password | `/reset-password` | anonymous + token | PII | Token in query |
| MFA verify | `/mfa` | anonymous + challenge | PII (OTP) | |
| Logout | `/logout` | session end | session cookies | Redirects → `/api/auth/logout` |
| OAuth callback | `/oauth/callback` | anonymous OAuth | OAuth code/state | Forwards → API callback |

---

## 1. Functionality

| Screen | Load OK | Empty/loading/error | Write path or N/A | Evidence |
| --- | --- | --- | --- | --- |
| `/login` | ☐ | ☐ | Sign-in write | `e2e/auth/signin-local.spec.ts` (mocked) |
| `/signup` | ☐ | ☐ | Sign-up write | `e2e/auth/signup.spec.ts` (mocked) |
| `/forgot-password` | ☐ | ☐ | Request reset | `e2e/auth/forgot-password.spec.ts` |
| `/reset-password` | ☐ | ☐ | Reset write | `e2e/auth/reset-password.spec.ts` |
| `/mfa` | ☐ | ☐ | Verify write | `e2e/auth/mfa-verify.spec.ts` |
| `/logout` | ☐ | N/A | Session clear | `e2e/auth/logout-oauth-redirect.spec.ts` |
| `/oauth/callback` | ☐ | error → login | N/A (BFF) | same smoke + API sanitize |

**Fixes shipped this branch**
- `sanitizeReturnTo` helper + unit tests
- Wired into login / signup / MFA forms and OAuth callback API
- Middleware login redirect only accepts same-origin relative `returnTo`
- Property test `PUBLIC_PATHS` synced to include `/signup`
- Extended axe / touch / dark / capture for Auth screens
- Always-on logout + OAuth + open-redirect Playwright smokes

Backend unit/property: `apps/web/src/lib/auth/return-to.test.ts`, existing session tests.

---

## 2. E2E (Playwright)

| Journey | Spec file | Live (`E2E_BACKEND_READY=1`) | Desktop | Mobile | Evidence |
| --- | --- | --- | --- | --- | --- |
| Mocked auth suite | `e2e/auth/*.spec.ts` | N/A (always on) | ☐ | ☐ | Existing |
| Logout / OAuth / redirect | `e2e/auth/logout-oauth-redirect.spec.ts` | N/A | ☐ | — | Added |
| Live login/logout | — | ☐ waived | — | — | No auth-service in agent; waiver below |

---

## 3. UX / a11y

| Check | Pass | Evidence |
| --- | --- | --- |
| axe WCAG 2.1 AA on Auth routes | ☐ | `e2e/a11y-axe.spec.ts` (+ forgot/reset/mfa) |
| Dark mode parity (Auth public) | ☐ | `e2e/dark-mode-parity.spec.ts` Auth block |
| Touch targets ≥44px | ☐ | `e2e/touch-target-minimum.spec.ts` PUBLIC_ROUTES |
| Keyboard / focus (MFA) | ☐ | existing MFA keyboard contract tests |

---

## 4. Multidevice captures

| Screen | Desktop 1440 | Tablet 834 | Mobile 390 | Artifact path |
| --- | --- | --- | --- | --- |
| Auth set in `capture-screens.mjs` | ☐ | ☐ | ☐ | `/opt/cursor/artifacts/auth-audit/` (when capture run) |

Horizontal scroll / clipped CTA issues: pending capture run.

---

## 5. Security

| Check | Pass | Evidence |
| --- | --- | --- |
| Unauthenticated dashboard → `/login` | ☐ | middleware |
| Open-redirect `returnTo` blocked | ☐ | `sanitizeReturnTo` + smoke |
| `/signup` publicly reachable | ☐ | middleware `PUBLIC_PATHS` |
| httpOnly session cookies | ☐ | `lib/auth/cookies.ts` |
| Cross-tenant IDOR | N/A | Auth is identity, not tenant resource CRUD |
| No secrets in git artifacts | ☐ | |

---

## 6. CI / production gates

| Gate | Pass | Link / SHA |
| --- | --- | --- |
| Lint / typecheck / unit | ☐ | tip PR CI |
| Auth unit (`return-to`) | ☐ | vitest |
| DoD / Lighthouse `/login` | ☐ | existing lighthouse config |

---

## 7. Residual risks / waivers

| Item | Risk | Owner | Waiver date |
| --- | --- | --- | --- |
| Live `E2E_BACKEND_READY` Auth happy/negative against real auth-service | Medium — mocked suite covers wiring; live IdP not in agent | cloud-agent | 2026-09-05 |
| CSRF on cookie-authenticated POSTs | Medium — SameSite=lax cookies; no CSRF token yet | platform | 2026-09-05 |
| Middleware JWT decode-only (no sig verify) | Known — gateway verifies | platform | pre-existing |
| PR #1 mega-branch not merged | High if forced — tip conflict/Lint fail | close or rebase separately | 2026-09-05 |

---

## Done criteria

- [x] Pillars evidence **or** dated waivers above  
- [ ] Walkthrough artifacts attached to PR (captures if stack up)  
- [ ] Session state set to `complete` via hooks helper  

**Verdict:** ☐ Not ready · ☑ Ready with waivers · ☐ Enterprise production-ready
