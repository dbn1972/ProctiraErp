---
name: enterprise-mobile-flutter
description: >-
  Enterprise Flutter / native mobile certification for ProctiraERP (auth, DI,
  analyze, goldens, integration, device-farm residuals). Use when testing or
  shipping apps/mobile, parent mode, staff shells, or claiming mobile parity
  with web.
---

# Enterprise Mobile Flutter (Definition of Native)

This skill is the **Definition of Native**. Web multidevice PNGs **do not** certify Flutter.

## When this skill applies

Trigger on: Flutter, mobile app, goldens, device-farm, parent mode routes, `apps/mobile`, native parity, Android/iOS.

## Required workflow

1. Copy `docs/audits/templates/ENTERPRISE_MOBILE_FLUTTER_CHECKLIST.md` → `docs/audits/MOBILE_<SLICE>.md` (or extend `MOBILE_FLUTTER_ENTERPRISE.md`).
2. Auth: real login path; Bearer + `X-Tenant-ID`; no fake pending tokens in production claims.
3. `flutter analyze` clean on touched packages; unit/golden tests for shells changed.
4. Integration journeys where environment allows; else dated waiver.
5. Parent mode must not replace staff shells unless product/IA says so.
6. Device-farm / real-device PNGs: produce or waive explicitly.
7. Cross-link web parent/staff audits when dual-surface.

## Honesty rules

- Linux goldens ≠ Android device-farm.
- Thin Flutter API clients must be labeled residual, not “complete”.
- Staff-leaning home preserved unless PRODUCT audit changes it.

## Related

- Production-ready Flutter section
- `docs/audits/MOBILE_FLUTTER_ENTERPRISE.md`
- `apps/mobile/`, `packages/flutter-core/`
