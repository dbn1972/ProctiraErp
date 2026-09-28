# Proctira ERP — design-review kit conventions (read fully before writing a screen)

Goal: one HTML mockup per real Proctira route, faithful to what the code renders today (structure, fields, actions, states), polished with the Proctira design system, and carrying a UX-review panel so reviewers can approve / request changes per screen. This is a **review of the existing product's UX**, not a redesign into a different product — mirror the real information, then make it well-designed.

Root: `/home/claude/proctira-design/`. Codebase: `/home/claude/proctira/` (Next.js apps under `apps/*`, backend under `packages/backend/*`, Flutter under `apps/mobile/lib`). Manifest of every screen you must produce: `tools/manifest.json` (fields: portal, module, file, name, route, source = the page.tsx / dart file to read, code_states = loading/error/not-found files that exist beside it). Full list of files: `tools/inventory.txt`.

## 1. Skeleton (web / student / parent / admin portals)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Fees · Invoices · Proctira ERP</title>
    <link rel="stylesheet" href="../shared/tokens.css" />
    <link rel="stylesheet" href="../shared/app.css" />
    <style>
      /* page-local only; tokens only (var(--brand-600), var(--viz-1)…) */
    </style>
  </head>
  <body data-portal="web" data-active="fees">
    <div class="shell">
      <nav class="sidebar" data-shell="sidebar" aria-label="Sidebar"></nav>
      <div class="shell-main">
        <header class="topbar" data-shell="topbar"></header>
        <main class="content">
          <div class="breadcrumbs">
            <a href="../dashboard/home.html">Home</a><span class="sep">/</span
            ><a href="overview.html">Fees</a><span class="sep">/</span
            ><span class="current">Invoices</span>
          </div>
          <div class="page-head">
            <div class="ph-text">
              <h1 class="page-title">Invoices</h1>
              <p class="page-sub">context line</p>
            </div>
            <div class="page-actions">…</div>
          </div>
          …
        </main>
      </div>
    </div>
    <script type="application/json" id="ux-review">
      { …see §3… }
    </script>
    <script src="../shared/app.js"></script>
  </body>
</html>
```

- `data-portal` ∈ `web` (staff dashboard, sidebar mirrors `apps/web/src/components/layout/sidebar.tsx`), `student`, `parent`, `admin` (admin-console). `data-active` = the nav id in `shared/app.js` for that portal (web ids: dashboard, institutions, academic-periods, students, admissions, staff, assessments, attendance, examinations, lms, scholarships, health, fees, transport, hostel, library, communication, notifications, workflows, data-warehouse, reports, audit-logs, billing, admin). Module folders that have no nav item (pipelines, help, tenant-lifecycle) use `data-active="admin"`.
- **No shell** for `auth/`, `public/`, `website/`, `registration/`, `developer/`, `install/`: full-page layouts (split hero for login, centred card for MFA/reset, marketing layout mirroring `MarketingLayout.tsx` for website, stepper for registration). Still link tokens.css + app.css, still include the ux-review block and `<script src="../shared/app.js">` (it is safe without the shell).
- **Mobile** (`mobile/`): link `../shared/tokens.css`, `../shared/app.css`, `../shared/mobile.css`, and `<script src="../shared/mobile.js">` + `<script src="../shared/app.js">`; structure `<div class="phone"><div class="screen">…</div></div>`; `<body data-tab="home|students|attendance|services|profile">` (omit for login/tenant-selection). Read `/home/claude/civitasone/mobile/home.html` for the m-* class vocabulary.

## 2. Fidelity rules

- Open the `source` file and its `_components`/actions/sibling files first. Reproduce the real page: its headings, tables and columns, filters, forms and field names, buttons, tabs, dialogs, status enums, i18n labels (look up keys in `apps/web/src/i18n` or `messages/` if labels are keys). Do not invent modules the code does not have; do not copy KIIT content — this is a school ERP (grades, classes, sections, academic periods, boards, guardians).
- Realistic Indian school data: Sunrise Public School (CBSE, Delhi East board), classes 1–12, sections A–D, students like Aarav Mehta (9-B), guardians, staff (Priya Sharma – Principal, Neha Verma – Class teacher 9-B, Sunil Rao – Accounts), fees in ₹ with lakh grouping, dates `26 Sep 2026`.
- Show every state the code has (`code_states` in the manifest → loading skeleton, error alert, not-found) plus a designed empty state, in tabs or hidden `[data-panel]` blocks when they cannot co-exist.
- Components: everything from `shared/app.css` (`.card .kpi .pill .tag .table[data-label] .person-cell .filter-bar .entity-picker .stepper .tabs[data-tab] .timeline .empty .skel .alert .switch .form-grid .field .dl .stat-row .progress .row-actions .icon-btn .kanban?  .legend .viz-wrap/.viz-tip .route-chip`). Icons: copy inline SVGs from `shared/app.js` (`icons` map). No external assets, no emoji icons.
- Charts: inline SVG, `var(--viz-1..5)` fixed order, `role="img"` + `aria-label`, `.legend` for ≥ 2 series, one y-axis.
- Responsive 1280 / 768 / 390: wide grids get an `overflow-x:auto` wrapper; local grids collapse at ≤ 767 px. Dark mode via tokens only.
- Accessibility: `aria-label` on icon-only buttons/links, labels on inputs, `th` in tables, `data-label` on `td`.

## 3. The ux-review block (mandatory, one per screen)

```json
{
  "route": "/fees/invoices",
  "module": "Fees",
  "actor": "Accounts officer, Principal",
  "purpose": "One sentence: what the user comes here to do.",
  "primaryAction": "Generate invoices for a fee plan",
  "source": "apps/web/src/app/(dashboard)/fees/invoices/page.tsx",
  "states": [
    "loading (loading.tsx)",
    "error (error.tsx)",
    "empty — designed here, not in code",
    "filled"
  ],
  "issues": [
    {
      "severity": "high",
      "text": "No empty state in code: the table renders zero rows with no guidance."
    },
    { "severity": "medium", "text": "Status uses colour only (no icon/text) in status-badge.tsx." }
  ],
  "checklist": ["optional: override the default 7-item checklist with screen-specific checks"]
}
```

`issues` must come from reading the code (missing states, colour-only status, raw ids in UI, no confirmation on destructive action, unclear primary action, inconsistent vocabulary, long forms without sections, tables without mobile transform, hard-coded strings vs i18n, missing pagination, no loading skeleton). 1–4 per screen; "none observed" is acceptable when true. Be specific and cite the file.

## 4. Self-check before returning

`node tools/lint.js <files>` → 0 FAIL. `NODE_PATH=/home/claude/.npm-global/lib/node_modules node /tmp/sweep2.js <module>/<file>.html …` (run from `/home/claude/proctira-design`, paths relative to it — the script resolves against `/home/claude/kiit-erp/`, so use the copy at `/tmp/sweep-pd.js` instead) → all three widths 0. Screenshot 2–3 screens with `/tmp/shot.js` and look.

## 5. Manifest to return

Per file: path · route · states · issues count · overflow OK · anything you could not determine from the code.
