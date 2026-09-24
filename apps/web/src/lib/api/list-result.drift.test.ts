/**
 * @vitest-environment node
 *
 * Ratchet for the "a denial looks like an empty list" pattern.
 *
 * The pattern is not `throwOnError: false` on its own — that option is also the right
 * answer for single-object reads (`getHealthRecord` returns `null`), for mutations that
 * construct their own error, and for `gateway.test.ts`, which is testing the option
 * itself. The pattern is a non-throwing read whose result is then **collapsed to an
 * empty array**, so 401, 403, 404, 5xx and "genuinely no rows" all reach the screen as
 * "No records found".
 *
 * So this counts the collapse, not the option: a `?? []` / `return []` whose enclosing
 * call used `throwOnError: false`. That makes the number reachable — every counted site
 * has `fetchList` as its answer — and keeps the failure message truthful for whoever
 * trips it.
 *
 * If you are here because this test failed:
 *   • you added a collapsing read → use `fetchList` from `./list-result`
 *   • you converted one → lower BASELINE in the same commit
 *
 * Exact rather than a ceiling, so a conversion that forgets the bookkeeping is caught
 * too. Lowering is the expected direction.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../..');

/**
 * Collapsing reads remaining. Measured by {@link countCollapsingReads}, not by grep: an
 * earlier revision of this file counted `throwOnError: false` occurrences — including prose
 * in doc comments, single-object reads and mutations — and reported 204/206/208 for a figure
 * that was 126.
 *
 * **126 → 113 (V15-10, hostel).** The whole `hostel` domain is converted: 13 data functions
 * onto `fetchList`, and all nine `(dashboard)/hostel/*` pages now render `ListLoadFailure`
 * for their primary list instead of an empty table. Supporting lookups that feed form
 * controls use `itemsOrEmpty` — an explicit opt-out at the call site, with the reason in a
 * comment, rather than a collapse hidden in the data layer.
 *
 * 23 modules remain, led by `examinations.ts` (10), `fees.ts` (10), `lms.ts` (9) and
 * `staff.ts` (9). The data-layer half of those converts almost mechanically; the cost is the
 * ~411 call-site type errors it produces, each needing a decision about whether that read is
 * the screen's subject or a lookup. Do them one domain per commit.
 *
 * The counter cannot see a page that calls a *wrapper* which collapses internally, so
 * converting a page without converting its data function leaves this number unchanged.
 * That is a known limit, not a silent one.
 */
const BASELINE = 113;

/** How many lines after `throwOnError: false` a collapse still counts as the same read. */
const WINDOW = 8;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** True for a comment-only line, so documenting the pattern is not using it. */
export function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** True for a line that collapses a result to an empty array. */
export function isCollapseLine(line: string): boolean {
  if (isCommentLine(line)) return false;
  return /\?\?\s*\[\]/.test(line) || /return\s*\[\]\s*;?\s*$/.test(line);
}

export function countCollapsingReads(): { total: number; files: string[] } {
  const files = new Set<string>();
  let total = 0;
  for (const file of walk(SRC)) {
    // The helper and this test are where the pattern is described, not used.
    if (/list-result(\.drift\.test|\.test)?\.tsx?$/.test(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isCommentLine(line) || !line.includes('throwOnError: false')) return;
      const collapses = lines
        .slice(i + 1, i + 1 + WINDOW)
        .some((candidate) => isCollapseLine(candidate));
      if (collapses) {
        total += 1;
        files.add(file.slice(SRC.length + 1));
      }
    });
  }
  return { total, files: [...files].sort() };
}

describe('list-result migration ratchet', () => {
  it('does not add new reads that render a denial as an empty list', () => {
    const { total } = countCollapsingReads();
    expect(
      total,
      total > BASELINE
        ? 'New collapsing read(s) added. Use fetchList() from @/lib/api/list-result so ' +
            '401/403/5xx do not render as "No records found".'
        : `${BASELINE - total} read(s) converted — lower BASELINE to ${total}.`,
    ).toBe(BASELINE);
  });

  it('counts the collapse, not the option and not prose about it', () => {
    // Guards the counter. `throwOnError: false` alone is legitimate on single-object
    // reads and mutations; only the collapse to [] is the defect.
    expect(isCommentLine('   * `throwOnError: false` collapses the outcome')).toBe(true);
    expect(isCommentLine('  // throwOnError: false here would hide a 403')).toBe(true);
    expect(isCommentLine('    throwOnError: false,')).toBe(false);

    expect(isCollapseLine('  return result.data?.data ?? [];')).toBe(true);
    expect(isCollapseLine('  return [];')).toBe(true);
    // A single-object read returns null, not []; it is not this pattern.
    expect(isCollapseLine('  return result.data;')).toBe(false);
    expect(isCollapseLine('   * return result.data?.data ?? [];')).toBe(false);
  });

  it('is reachable: every counted read has fetchList as its answer', () => {
    // The previous revision counted `throwOnError: false` occurrences, about a third of
    // which were single-object reads, mutations or gateway unit tests. BASELINE could
    // never have reached 0, and the failure message gave those authors wrong advice.
    const { total, files } = countCollapsingReads();
    expect(total).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
    // Files that only use the option without collapsing must not be counted.
    expect(files).not.toContain('lib/api/gateway.test.ts');
  });
});
