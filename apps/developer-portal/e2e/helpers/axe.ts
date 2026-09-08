/**
 * Shared axe-core runner for Developer Portal Playwright smokes (WCAG 2.1 AA).
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const WCAG_2_1_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

export async function runAxe(
  page: Page,
  options: { checkpointLabel?: string; disabledRules?: string[] } = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_2_1_AA_TAGS]);
  if (options.disabledRules?.length) {
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
