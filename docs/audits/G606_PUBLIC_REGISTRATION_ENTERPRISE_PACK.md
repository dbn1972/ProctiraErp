# G-606 — Public website + Registration portal enterprise packs (minimum)

**Date (UTC):** 2026-09-08  
**Branch:** `cursor/enterprise-gap-close-56c3`  
**Status:** DONE (minimum packs + checklist evidence)

## Evidence sources (existing checklists)

| Surface             | Checklist                                                     | Score noted |
| ------------------- | ------------------------------------------------------------- | ----------- |
| Public website      | `docs/audits/PUBLIC_WEBSITE_HOME_PRODUCT_LEGAL_CONTACT.md`    | 9.5 / 10    |
| Registration portal | `docs/audits/REGISTRATION_PORTAL_HOME_SCHOOLS_APPLY_TRACK.md` | 9.5 / 10    |

## Minimum pack coverage

### Public website — SEO / forms / a11y / spam

| Control                       | Evidence                                                                |
| ----------------------------- | ----------------------------------------------------------------------- |
| SEO metadata (`metadataBase`) | `apps/public-website/src/app/layout.tsx` + per-route `metadata` exports |
| Contact forms                 | `POST /api/contact` + `contact-validation.ts` Vitest                    |
| Spam honeypot + rate limit    | honeypot field + `contact-rate-limit.ts` Vitest                         |
| a11y axe                      | `e2e/02-a11y-axe.spec.ts` (key routes)                                  |
| Inventory smoke               | `e2e/01-public-website-smoke.spec.ts`                                   |

### Registration portal — forms / a11y / spam-adjacent

| Control                | Evidence                                           |
| ---------------------- | -------------------------------------------------- |
| Apply / track forms    | App Router apply + track DOB gate                  |
| Validation             | `src/lib/validation.ts` + Vitest                   |
| a11y axe               | `e2e/02-a11y-axe.spec.ts`                          |
| Inventory smoke        | `e2e/01-registration-portal-smoke.spec.ts`         |
| Live wrong-DOB backend | Residual / waived without mounted live apply stack |

## Residuals (honest)

- Live registration apply against gateway still gated / residual when service not mounted for public apply.
- Contact webhook CRM forward optional (`CONTACT_WEBHOOK_URL`).
- No visual-diff CI for marketing routes in this pack.

## How to refresh

```bash
pnpm --filter @proctira/public-website test
pnpm --filter @proctira/registration-portal test
# Playwright smokes under each app's e2e/
```
