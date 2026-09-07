/**
 * Shared axe-core runner for Registration Portal Playwright e2e.
 * WCAG 2.1 AA tags; fails on any violation with a compact summary.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const WCAG_2_1_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

export interface RunAxeOptions {
  include?: string | string[];
  exclude?: string | string[];
  disabledRules?: string[];
  checkpointLabel?: string;
}

export async function runAxe(page: Page, options: RunAxeOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_2_1_AA_TAGS]).exclude('nextjs-portal');

  if (options.include) {
    const includes = Array.isArray(options.include) ? options.include : [options.include];
    for (const selector of includes) {
      builder = builder.include(selector);
    }
  }

  if (options.exclude) {
    const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
    for (const selector of excludes) {
      builder = builder.exclude(selector);
    }
  }

  if (options.disabledRules && options.disabledRules.length > 0) {
    builder = builder.disableRules(options.disabledRules);
  }

  const result = await builder.analyze();
  if (result.violations.length === 0) return;

  const label = options.checkpointLabel ? ` (${options.checkpointLabel})` : '';
  const summary = result.violations
    .map((v) => {
      const target = v.nodes[0]?.target?.join(' > ') ?? '<no target reported>';
      return `  • [${v.impact ?? 'unknown'}] ${v.id} — ${v.help}\n    first node: ${target}`;
    })
    .join('\n');

  expect(
    result.violations,
    `axe-core found ${result.violations.length} WCAG 2.1 AA violation(s)${label}:\n${summary}`,
  ).toEqual([]);
}
