---
inclusion: auto
name: school-sis-product-experience
description: Repository-specific product, UX/UI, accessibility, localization, mobile, offline, portal, dashboard, form, workflow, adoption, and capability-completion context for ProctiraErp School/SIS work.
---

# ProctiraErp product and experience context

Apply `world-class-sis-product` for product decisions and `inclusive-sis-experience` for UX/UI work. Those skills are the procedural authorities; this file only identifies the active repository surfaces.

## Repository map

- Staff web experience: `apps/web`. Verify the active Next.js route, feature shell, auth/session path, and API client because overlapping paths exist.
- Mobile experience: `apps/mobile`. Inspect the current tenant cache, sync/offline implementation, and actual module parity before making claims.
- Public applicant experience: `apps/registration-portal` plus active public registration routes under `apps/web`.
- Canonical web design system: `packages/ui/components`, `packages/ui/styles/theme.css`, and `packages/ui/README.md`. Screen-local copies are not another authority.
- Localization sources: each active app's i18n configuration and message catalogs; verify which catalog the running surface loads.
- Capability evidence path: active client → API client/contract → gateway-mounted domain → production repository/Prisma → jobs/integrations → behavior and operating evidence.

Use `school-sis-erp-context` to trace the vertical slice. Treat screenshots, design references, menu entries, placeholders, mock data, and module-status documents as subordinate to the active implementation.
