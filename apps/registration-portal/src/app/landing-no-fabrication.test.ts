/**
 * PRC-M052 — the landing page must not show fabricated statistics or an
 * unconditional "admissions open" badge.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8');

describe('PRC-M052 landing page has no fabricated figures', () => {
  it('contains no hard-coded stat literals', () => {
    for (const literal of ['12,847', '2.5M', '98%']) expect(source).not.toContain(literal);
    expect(source).not.toMatch(/value:\s*'[\d.,]+[%MK]?'/);
  });

  it('does not render an unconditional admissions-open badge or stats bar', () => {
    expect(source).not.toContain("stats.open");
    expect(source).not.toContain('StatsBar');
  });
});
