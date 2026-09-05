#!/usr/bin/env node
/**
 * Standalone scanner for the `proctira/no-hardcoded-brand-strings` ESLint
 * rule.
 *
 * The repo's main `pnpm lint` cascade depends on `@typescript-eslint/parser`
 * with type-aware rules, which in turn requires every workspace package to
 * have its `node_modules` populated. This scanner side-steps that issue: it
 * runs ONLY our custom brand-neutrality rule against the files in `apps/`,
 * `packages/ui/`, and `packages/backend/notification/` using the bundled
 * `@typescript-eslint/parser` (no project-aware type checking) so the
 * brand-neutrality check can run in CI without a full install of every
 * downstream package.
 *
 * Pre-existing brand strings (e.g. `apps/web/src/app/layout.tsx` `title:
 * 'ProctiraERP'`) are tracked as KNOWN violations to be fixed in tasks 57.5 /
 * 58 and are excluded from the failure budget so this scanner can be
 * promoted to a hard gate as soon as those tasks land.
 *
 * Exit code = number of NEW (non-known) violations so it works as a CI gate.
 */

import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * Files we already know contain brand literals. Each entry is a repo-relative
 * forward-slash path; the scanner treats violations in these files as known
 * baseline violations, prints them as warnings, and does NOT count them
 * toward the exit code. Tasks 57.5 / 58 will replace these with
 * `useBrand()` / `<DocumentTitle>` / `{{brand_name}}` and the entry can
 * then be removed from this list (effectively making the gate strict).
 *
 * Last baselined: task 57.3.
 */
const KNOWN_VIOLATIONS = new Set([
  // apps/web (originally identified by task 57.3 description)
  "apps/web/src/app/layout.tsx",
  "apps/web/src/app/(auth)/login/page.tsx",
  "apps/web/src/app/App.test.tsx",
  "apps/web/src/components/layout/sidebar.tsx",
  "apps/web/src/messages/ar.json",
  "apps/web/src/messages/en.json",
  "apps/web/src/providers/BrandConfigProvider.tsx",
  "apps/web/src/providers/LanguageProvider.tsx",
  // apps/admin-console
  "apps/admin-console/src/app/(auth)/login/page.tsx",
  "apps/admin-console/src/app/layout.tsx",
  "apps/admin-console/src/components/layout/sidebar.tsx",
  "apps/admin-console/src/lib/api/plugins.ts",
  // apps/developer-portal
  "apps/developer-portal/src/app/layout.tsx",
  "apps/developer-portal/src/app/page.tsx",
  "apps/developer-portal/src/components/layout/sidebar.tsx",
  // apps/install-wizard
  "apps/install-wizard/src/app/layout.tsx",
  "apps/install-wizard/src/components/install-wizard.tsx",
  "apps/install-wizard/src/components/steps/complete-step.tsx",
  "apps/install-wizard/src/components/steps/database-step.tsx",
  "apps/install-wizard/src/components/steps/queue-step.tsx",
  "apps/install-wizard/src/lib/api-client.test.ts",
  // apps/public-website
  "apps/public-website/src/app/about/page.tsx",
  "apps/public-website/src/app/compliance/page.tsx",
  "apps/public-website/src/app/contact/page.tsx",
  "apps/public-website/src/app/cookies/page.tsx",
  "apps/public-website/src/app/installation/page.tsx",
  "apps/public-website/src/app/layout.tsx",
  "apps/public-website/src/app/legal/page.tsx",
  "apps/public-website/src/app/page.tsx",
  "apps/public-website/src/app/privacy/page.tsx",
  "apps/public-website/src/app/product/page.tsx",
  "apps/public-website/src/app/security/page.tsx",
  "apps/public-website/src/app/status/page.tsx",
  "apps/public-website/src/app/terms/page.tsx",
  "apps/public-website/src/components/layout/site-header.tsx",
  // apps/registration-portal
  "apps/registration-portal/src/app/layout.tsx",
  "apps/registration-portal/src/components/layout/header.tsx",
  // Additional baseline (pre-existing on this branch; tracked for tasks 57.5 / 58)
  "apps/web/src/app/(auth)/login/login-branding.test.tsx",
  "apps/web/src/app/(auth)/signup/signup-form.tsx",
  "apps/web/src/app/(dashboard)/students/import/page.tsx",
  "apps/web/src/app/(marketing)/installation/page.tsx",
  "apps/web/src/app/(marketing)/legal/cookies/page.tsx",
  "apps/web/src/app/(marketing)/legal/page.tsx",
  "apps/web/src/app/(marketing)/security/compliance/page.tsx",
  "apps/web/src/app/(marketing)/security/page.tsx",
  "apps/web/src/app/(marketing)/status/page.tsx",
  "apps/web/src/components/DocumentTitle.test.tsx",
  "apps/web/src/components/layout/MarketingLayout.test.tsx",
  "apps/web/src/components/layout/MobileShell.test.tsx",
  "apps/web/src/components/layout/sidebar.keyboard.test.tsx",
  "apps/web/src/components/registration/portal-shell.tsx",
  "apps/web/src/features/auth/MFASetup.test.tsx",
  "apps/web/src/features/auth/MFASetup.tsx",
  "apps/web/src/features/auth/MFAVerify.test.tsx",
  "apps/web/src/features/auth/SignIn.test.tsx",
  "apps/web/src/features/legal/PrivacyPolicy.tsx",
  "apps/web/src/features/legal/TermsOfService.tsx",
  "apps/web/src/features/marketing/__tests__/marketing-pages.test.tsx",
  "apps/web/src/features/settings/__tests__/SettingsBrandingPage.test.tsx",
  "apps/web/src/features/settings/__tests__/SettingsGeneralPage.test.tsx",
  "apps/web/src/lib/api/auth.ts",
  "apps/web/src/lib/tenant-theme/server.test.ts",
  "apps/web/src/lib/tenant-theme/server.ts",
  "apps/web/src/middleware.ts",
  "apps/web/src/providers/BrandConfigProvider.test.tsx",
  "apps/web/src/providers/LanguageProvider.test.tsx",
  "apps/web/src/providers/ThemeProvider.test.tsx",
  "packages/backend/notification/src/templates/templates.test.ts",
  "packages/ui/dashboards/src/WelcomeBanner.test.tsx",
]);

const eslint = new ESLint({
  cwd: repoRoot,
  useEslintrc: false,
  resolvePluginsRelativeTo: repoRoot,
  // Disable inline `// eslint-disable …` directives so our scanner doesn't
  // emit "rule not found" noise for rules that other configs load. We are
  // ONLY enforcing our custom brand-neutrality rule here.
  allowInlineConfig: false,
  baseConfig: {
    parser: "@typescript-eslint/parser",
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      ecmaFeatures: { jsx: true },
    },
    plugins: ["proctira"],
    rules: {
      "proctira/no-hardcoded-brand-strings": "error",
    },
    overrides: [
      // The rule itself already skips `*.config.{ts,js,mjs,cjs}` and
      // `theme.css` based on filename, and skips locale catalogs marked
      // with `_brand: true`. We additionally disable the rule on JSON
      // message catalogs, which the parser can't load as TS modules
      // anyway — those are scanned by the rg-based check in task 57.4.
      {
        files: ["**/*.json"],
        rules: {
          "proctira/no-hardcoded-brand-strings": "off",
        },
      },
    ],
  },
});

const targets = [
  "apps/web/src/**/*.{ts,tsx}",
  "apps/public-website/src/**/*.{ts,tsx}",
  "apps/registration-portal/src/**/*.{ts,tsx}",
  "apps/admin-console/src/**/*.{ts,tsx}",
  "apps/developer-portal/src/**/*.{ts,tsx}",
  "apps/install-wizard/src/**/*.{ts,tsx}",
  "packages/ui/**/src/**/*.{ts,tsx}",
  "packages/backend/notification/**/*.{ts,tsx}",
];

const results = await eslint.lintFiles(targets);

/** Convert an absolute file path to a repo-relative forward-slash path. */
function toRepoRelative(absPath) {
  const rel = path.relative(repoRoot, absPath);
  return rel.split(path.sep).join("/");
}

const newViolationFiles = [];
const knownViolationFiles = [];
let newErrorCount = 0;
let knownErrorCount = 0;

for (const r of results) {
  if (r.errorCount === 0 && r.warningCount === 0) continue;
  const rel = toRepoRelative(r.filePath);
  if (KNOWN_VIOLATIONS.has(rel)) {
    knownViolationFiles.push(rel);
    knownErrorCount += r.errorCount;
  } else {
    newViolationFiles.push(rel);
    newErrorCount += r.errorCount;
  }
}

const formatter = await eslint.loadFormatter("stylish");
const formatted = formatter.format(
  results.filter((r) => !KNOWN_VIOLATIONS.has(toRepoRelative(r.filePath))),
);
if (formatted) {
  process.stdout.write(formatted);
}

if (knownErrorCount > 0) {
  console.warn(
    `⚠️  no-hardcoded-brand-strings: ${knownErrorCount} known baseline violation(s) across ${knownViolationFiles.length} allow-listed file(s) (tracked in tasks 57.5 / 58):`,
  );
  for (const f of knownViolationFiles) console.warn(`     - ${f}`);
}

if (newErrorCount === 0) {
  console.log(
    `✅ no-hardcoded-brand-strings: 0 new violation(s) across ${results.length} file(s).`,
  );
  process.exit(0);
}

console.error(
  `❌ no-hardcoded-brand-strings: ${newErrorCount} new violation(s) across ${newViolationFiles.length} file(s).`,
);
process.exit(1);
