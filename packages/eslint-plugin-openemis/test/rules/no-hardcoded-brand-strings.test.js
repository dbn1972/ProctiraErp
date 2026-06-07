"use strict";

const { RuleTester } = require("eslint");
const rule = require("../../src/rules/no-hardcoded-brand-strings");

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
});

ruleTester.run("no-hardcoded-brand-strings", rule, {
  valid: [
    // ── Plain code with no brand strings ───────────────────────────────
    {
      code: "const x = 'hello world';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    {
      code: "<h1>Welcome to your dashboard</h1>",
      filename: "/repo/apps/web/src/page.tsx",
    },
    // Identifier-style substring (no word boundary) — NOT flagged.
    {
      code: "const cls = 'theProctiraERPClass';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    {
      code: "const id = 'myproctira2024';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    // ── Identifier-style adjacency — NOT flagged ───────────────────────
    // CSS classes, BEM-style.
    {
      code: "<div className=\"proctira-data-grid__row\" />",
      filename: "/repo/apps/web/src/grid.tsx",
    },
    // Workspace package import path (string literal in object value).
    {
      code: "const pkg = '@proctira/ui/area-picker';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    // Hostnames / URLs.
    {
      code: "const host = 'audit.proctira.org';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    {
      code: "const url = 'https://docs.proctira.com/api';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    // URL paths and storage keys.
    {
      code: "const key = 'proctira-theme';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    {
      code: "const env = 'OPENEMIS_API_KEY';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    // Module specifiers in import/require are not user-facing copy.
    {
      code: "import { foo } from '@proctira/ui';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    {
      code: "const x = require('@proctira/ui');",
      filename: "/repo/apps/web/src/foo.ts",
    },
    {
      code: "export { foo } from '@proctira/ui';",
      filename: "/repo/apps/web/src/foo.ts",
    },
    // useBrand() output is fine.
    {
      code:
        "import { useBrand } from '@/providers/BrandConfigProvider';\n" +
        "function Title() { const { name } = useBrand(); return <h1>{name}</h1>; }",
      filename: "/repo/apps/web/src/title.tsx",
    },
    // Allowlist: *.config.ts file may reference the brand directly.
    {
      code: "export const brandConfig = { name: 'ProctiraERP', slug: 'proctira' };",
      filename: "/repo/apps/web/brand.config.ts",
    },
    // Allowlist: theme.css -- the rule never runs on css, but if it did the
    // file would be skipped. Use a JS file with a `.config.js` suffix to
    // exercise the static allowlist branch.
    {
      code: "module.exports = { brandName: 'ProctiraERP' };",
      filename: "/repo/apps/web/next.config.js",
    },
    // Allowlist: packages/ui/branding/** is the canonical brand asset folder.
    {
      code: "export const DEFAULT_BRAND_NAME = 'ProctiraERP';",
      filename: "/repo/packages/ui/branding/default.ts",
    },
    // Allowlist: locale catalog with `_brand: true` marker can mention brand.
    {
      code:
        "export default {\n" +
        "  _brand: true,\n" +
        "  appName: 'ProctiraERP',\n" +
        "};",
      filename: "/repo/packages/shared/i18n/locales/en/brand.ts",
    },
    // Allowlist: locale catalog with quoted "_brand" marker.
    {
      code:
        "module.exports = {\n" +
        '  "_brand": true,\n' +
        '  "appName": "EduZo"\n' +
        "};",
      filename: "/repo/packages/shared/i18n/locales/fr/brand.cjs",
    },
    // Custom brand list excludes the default — "ProctiraERP" no longer flagged.
    {
      code: "const x = 'ProctiraERP Welcome';",
      options: [{ brands: ["AcmeEdu"] }],
      filename: "/repo/apps/web/src/foo.ts",
    },
  ],

  invalid: [
    // ── JSX text node with brand ───────────────────────────────────────
    {
      code: "function Header() { return <h1>ProctiraERP</h1>; }",
      filename: "/repo/apps/web/src/header.tsx",
      errors: [
        {
          messageId: "hardcoded",
          data: { brand: "ProctiraERP" },
        },
      ],
    },
    // JSX text containing brand in a sentence.
    {
      code: "function Hero() { return <p>Welcome to ProctiraERP, partner.</p>; }",
      filename: "/repo/apps/web/src/hero.tsx",
      errors: [{ messageId: "hardcoded", data: { brand: "ProctiraERP" } }],
    },
    // JSX attribute string literal (alt / title / aria-label).
    {
      code: '<img src="/logo.svg" alt="ProctiraERP Logo" />',
      filename: "/repo/apps/web/src/logo.tsx",
      errors: [{ messageId: "hardcoded", data: { brand: "ProctiraERP" } }],
    },
    {
      code: '<button title="Open EduZo settings">Settings</button>',
      filename: "/repo/apps/web/src/settings.tsx",
      errors: [{ messageId: "hardcoded", data: { brand: "EduZo" } }],
    },
    // Object literal property: page title or email subject.
    {
      code: "export const metadata = { title: 'ProctiraERP' };",
      filename: "/repo/apps/web/src/app/layout.tsx",
      errors: [{ messageId: "hardcoded", data: { brand: "ProctiraERP" } }],
    },
    {
      code: "const subject = 'Welcome to ProctiraERP';",
      filename: "/repo/packages/backend/notification/templates/welcome.ts",
      errors: [{ messageId: "hardcoded", data: { brand: "ProctiraERP" } }],
    },
    // Template literal quasi.
    {
      code: "const greeting = `Welcome to ProctiraERP, ${user}`;",
      filename: "/repo/apps/web/src/welcome.ts",
      errors: [{ messageId: "hardcoded", data: { brand: "ProctiraERP" } }],
    },
    // Case-insensitive: lowercase brand still flagged.
    {
      code: "const x = 'powered by proctira';",
      filename: "/repo/apps/web/src/footer.ts",
      errors: [{ messageId: "hardcoded", data: { brand: "proctira" } }],
    },
    // Multiple brands in same string → multiple reports.
    {
      code: "const both = 'ProctiraERP or EduZo, your choice';",
      filename: "/repo/apps/web/src/marketing.ts",
      errors: [
        { messageId: "hardcoded", data: { brand: "ProctiraERP" } },
        { messageId: "hardcoded", data: { brand: "EduZo" } },
      ],
    },
    // Custom brand option list: "AcmeEdu" is now a flagged brand.
    {
      code: "const x = 'Welcome to AcmeEdu';",
      options: [{ brands: ["AcmeEdu"] }],
      filename: "/repo/apps/web/src/foo.ts",
      errors: [{ messageId: "hardcoded", data: { brand: "AcmeEdu" } }],
    },
    // A locale catalog WITHOUT the `_brand: true` marker is NOT allowlisted.
    {
      code:
        "export default {\n" +
        "  appName: 'ProctiraERP',\n" +
        "};",
      filename: "/repo/packages/shared/i18n/locales/en/common.ts",
      errors: [{ messageId: "hardcoded", data: { brand: "ProctiraERP" } }],
    },
  ],
});

console.log("✅ no-hardcoded-brand-strings rule tests passed");
