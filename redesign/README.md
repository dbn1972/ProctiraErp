# CivitasOne Redesign v2.0

World-class redesign of all 124 CivitasOne screens as responsive HTML mockups — web app, all portals, and the native (Flutter) mobile app. Open **index.html** in a browser to browse everything with a Desktop / Tablet / Mobile toggle.

## What changed vs. the current product

| Problem in current UI                                  | Redesign                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Raw "Class UUID / Subject UUID" text inputs            | Searchable entity pickers showing name + context                               |
| Spec text leaking into UI ("Requirement 9.7")          | Plain, user-facing language                                                    |
| Login card floating in an empty half-page              | Branded split layout with product value panel                                  |
| Empty dashboard ("--" cards)                           | Role-aware dashboard: KPIs with trends, charts, approvals inbox, quick actions |
| 14 flat sidebar items, broken bullet icons             | Grouped, iconified navigation with tenant switcher and active-item rail        |
| Mobile: duplicate logo, bottom nav overlapping content | Single shell, safe-area-padded bottom nav, drawer menu                         |
| Tablet: detached search icon, truncated filters        | Inline filter bar that wraps correctly at every width                          |
| Text "View / Edit" links in tables                     | Avatared person cells, status pills, icon row-actions, mobile card transform   |
| No global search, no notifications                     | Topbar with ⌘K command palette, notifications, theme toggle                    |

## Structure

- `shared/` — design tokens (`tokens.css`), component library (`app.css`), shell renderer (`app.js`) — incl. dark mode
- `web/` — 67 screens of the main school ERP
- `admin-console/` — 13 platform-operator screens (own darker shell)
- `registration/` — 7 public parent-facing screens
- `website/` — 12 marketing/legal pages (`site.css`)
- `developer-portal/`, `install-wizard/` — 1 each
- `mobile/` — 23 native mobile app screens (phone-frame mockups for the Flutter app: offline-first sync states, biometric login, geofenced attendance, document scanning)

Every screen is a single self-contained HTML file (no CDN JS, inline SVG icons) and is responsive desktop → tablet → mobile from the same file.
