/**
 * @vitest-environment node
 *
 * Ratchet for the "a denial looks like an empty list" pattern.
 *
 * `gatewayFetch(..., { throwOnError: false })` followed by `?? []` collapses 401, 403,
 * 404, 5xx and "genuinely no rows" into the same `T[]`, so every one of them renders as
 * "No records found". Converting all of them at once would be an unreviewable diff
 * across 29 files, so the migration is incremental — and this test is what stops the
 * pattern spreading while it proceeds.
 *
 * If you are here because this test failed:
 *   • adding a collapsing call site → use `fetchList` from `./list-result` instead
 *   • converting one → lower BASELINE to the new count in the same commit
 *
 * Lowering is the expected direction. The number is deliberately exact, not a ceiling,
 * so a conversion that forgets to update it is also caught.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../..');

/**
 * Call sites remaining at the time `list-result.ts` was introduced, after converting
 * `listHealthRecords`. Measured by this function, not by grep: prose in a doc comment
 * mentioning the option must not count as a call site.
 */
const BASELINE = 204;

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

/** True for a line that is comment-only, so documentation of the pattern is not a use. */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

export function countCollapsingCallSites(): { total: number; files: string[] } {
  const files = new Set<string>();
  let total = 0;
  for (const file of walk(SRC)) {
    // The helper itself and this test are where the pattern is described, not used.
    if (/list-result(\.drift\.test)?\.ts$/.test(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (isCommentLine(line)) continue;
      if (line.includes('throwOnError: false')) {
        total += 1;
        files.add(file.slice(SRC.length + 1));
      }
    }
  }
  return { total, files: [...files].sort() };
}

describe('list-result migration ratchet', () => {
  it('does not add new call sites that render a denial as an empty list', () => {
    const { total } = countCollapsingCallSites();
    expect(
      total,
      total > BASELINE
        ? `New \`throwOnError: false\` call site(s) added. Use fetchList() from ` +
            `@/lib/api/list-result so 401/403/5xx do not render as "No records found".`
        : `${BASELINE - total} call site(s) converted — lower BASELINE to ${total}.`,
    ).toBe(BASELINE);
  });

  it('counts uses, not documentation of the pattern', () => {
    // Guards the counter itself: the doc comments in list-result.ts quote the option,
    // and a naive grep reported 208 where there were 204 real call sites.
    expect(isCommentLine('   * `throwOnError: false` collapses the outcome')).toBe(true);
    expect(isCommentLine('  // throwOnError: false here would hide a 403')).toBe(true);
    expect(isCommentLine('    throwOnError: false,')).toBe(false);
  });
});
