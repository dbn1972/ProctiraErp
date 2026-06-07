/**
 * Task 56.7 — Shared axe-core runner for Playwright e2e tests.
 *
 * Wraps `@axe-core/playwright`'s `AxeBuilder` so every spec uses the
 * same WCAG 2.1 AA rule-set and the same failure semantics:
 *
 *   • Tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` — the four tag
 *     groups axe-core ships that together cover WCAG 2.1 AA. See
 *     https://github.com/dequelabs/axe-core/blob/master/doc/API.md#axe-core-tags.
 *   • Failure: any `violations.length > 0` aborts the test with a
 *     formatted report so reviewers see the exact rule, impact, and
 *     selector chain inline in the Playwright output.
 *
 * The helper is intentionally tiny so individual specs can sprinkle
 * `await runAxe(page)` checkpoints without ceremony, and so a dedicated
 * a11y spec can iterate over surfaces and call `runAxe` per route.
 *
 * Requirements: 37.7, 37.8
 * Design: K — Accessibility Implementation Plan / WCAG 2.1 AA
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * The canonical tag set that, together, cover WCAG 2.1 AA. Defined as a
 * `readonly` tuple so callers cannot mutate it and the type system can
 * surface the exact set of tags via tooltips.
 */
export const WCAG_2_1_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
] as const;

export interface RunAxeOptions {
  /**
   * Additional CSS selectors to include in the scan (defaults to the
   * full document). Useful when a spec wants to scope the check to a
   * landmark such as `main` or a specific dialog while a spinner is
   * still resolving elsewhere on the page.
   */
  include?: string | string[];
  /**
   * Selectors to exclude from the scan. Use sparingly — every excluded
   * region is one less surface the gate covers. Typical use is third-
   * party iframes that we cannot fix (e.g. embedded Mapbox tile
   * widgets) where filing an upstream bug is the right answer.
   */
  exclude?: string | string[];
  /**
   * Disable specific axe rules by id. Reach for this only with a
   * tracked exception; passing rule IDs here is a code smell that
   * should be paired with a TODO and a Jira/Linear link in the spec.
   */
  disabledRules?: string[];
  /**
   * Optional human-readable label that gets appended to the failure
   * message so a single test with multiple checkpoints can identify
   * which checkpoint failed.
   */
  checkpointLabel?: string;
}

/**
 * Runs axe-core against the current page (or a scoped subtree) at the
 * WCAG 2.1 AA tag set and asserts no violations were reported.
 *
 * On failure the assertion message contains a compact summary (rule id,
 * impact, count) plus the first failing selector for each rule, which
 * is enough context to triage without dumping the full JSON payload.
 */
export async function runAxe(
  page: Page,
  options: RunAxeOptions = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_2_1_AA_TAGS]);

  if (options.include) {
    const includes = Array.isArray(options.include)
      ? options.include
      : [options.include];
    for (const selector of includes) {
      builder = builder.include(selector);
    }
  }

  if (options.exclude) {
    const excludes = Array.isArray(options.exclude)
      ? options.exclude
      : [options.exclude];
    for (const selector of excludes) {
      builder = builder.exclude(selector);
    }
  }

  if (options.disabledRules && options.disabledRules.length > 0) {
    builder = builder.disableRules(options.disabledRules);
  }

  const result = await builder.analyze();

  if (result.violations.length === 0) {
    return;
  }

  const label = options.checkpointLabel
    ? ` (${options.checkpointLabel})`
    : '';
  const summary = result.violations
    .map((v) => {
      const target =
        v.nodes[0]?.target?.join(' > ') ?? '<no target reported>';
      return `  • [${v.impact ?? 'unknown'}] ${v.id} — ${v.help}\n    first node: ${target}`;
    })
    .join('\n');

  // Custom assertion → preserves Playwright's nice error formatting and
  // makes the report grep-able in CI logs.
  expect(
    result.violations,
    `axe-core found ${result.violations.length} WCAG 2.1 AA violation(s)${label}:\n${summary}`,
  ).toEqual([]);
}
