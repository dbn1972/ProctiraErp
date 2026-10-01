#!/usr/bin/env node
/**
 * Standalone scanner for the `proctira/icon-only-button-requires-aria-label`
 * ESLint rule.
 *
 * The repo's main `pnpm lint` cascade depends on `@typescript-eslint/parser`
 * with type-aware rules, which in turn requires every workspace package to
 * have its `node_modules` populated. This scanner side-steps that issue: it
 * runs ONLY our custom accessibility rule against the files in
 * `apps/web/src/**` and `packages/ui/**` using the bundled
 * `@typescript-eslint/parser` (no project-aware type checking) so the
 * accessibility check can run in CI without a full install of every
 * downstream package.
 *
 * Exits 1 on any violation so it works as a CI gate. Optional positional
 * arguments replace the default globs (used by the fixture test):
 *   node tools/scripts/check-icon-only-button.mjs path/to/File.tsx
 *
 * ESLint pin (PRC-L387): this scanner uses the legacy eslintrc `ESLint`
 * options (`useEslintrc`, `resolvePluginsRelativeTo`) that ESLint 9 removed.
 * It refuses to run on any major other than 8; migrate to the flat-config API
 * (`overrideConfigFile` + `overrideConfig` array) in the same PR that bumps
 * the root `eslint` devDependency.
 */

import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const SUPPORTED_ESLINT_MAJOR = 8;
const eslintMajor = Number.parseInt(String(ESLint.version).split('.')[0], 10);
if (eslintMajor !== SUPPORTED_ESLINT_MAJOR) {
  console.error(
    `❌ check-icon-only-button: ESLint ${ESLint.version} is unsupported (eslintrc API needs v${SUPPORTED_ESLINT_MAJOR}); migrate this scanner to flat config.`,
  );
  process.exit(1);
}

const eslint = new ESLint({
  cwd: repoRoot,
  useEslintrc: false,
  resolvePluginsRelativeTo: repoRoot,
  // Disable inline `// eslint-disable …` directives so our scanner doesn't
  // emit "rule not found" noise for rules that other configs load (e.g.
  // `react-hooks/exhaustive-deps`, `@typescript-eslint/no-explicit-any`).
  // We are ONLY enforcing our custom accessibility rule here.
  allowInlineConfig: false,
  baseConfig: {
    parser: '@typescript-eslint/parser',
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
    plugins: ['proctira'],
    rules: {
      'proctira/icon-only-button-requires-aria-label': 'error',
    },
  },
});

const DEFAULT_TARGETS = [
  'apps/web/src/**/*.{ts,tsx}',
  'apps/public-website/src/**/*.{ts,tsx}',
  'apps/registration-portal/src/**/*.{ts,tsx}',
  'apps/admin-console/src/**/*.{ts,tsx}',
  'apps/developer-portal/src/**/*.{ts,tsx}',
  'apps/install-wizard/src/**/*.{ts,tsx}',
  'packages/ui/**/src/**/*.{ts,tsx}',
];

const cliTargets = process.argv.slice(2);
const targets = cliTargets.length > 0 ? cliTargets : DEFAULT_TARGETS;
const results = await eslint.lintFiles(targets);
const formatter = await eslint.loadFormatter('stylish');
const output = formatter.format(results);
if (output) {
  process.stdout.write(output);
}

const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
const fileCount = results.filter((r) => r.errorCount > 0).length;

if (errorCount === 0) {
  console.log(
    `✅ icon-only-button-requires-aria-label: 0 violations across ${results.length} file(s).`,
  );
  process.exit(0);
}

console.error(
  `❌ icon-only-button-requires-aria-label: ${errorCount} violation(s) across ${fileCount} file(s).`,
);
process.exit(1);
