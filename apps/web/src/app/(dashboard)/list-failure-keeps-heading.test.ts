/**
 * @vitest-environment node
 *
 * A page whose list read failed must still have an `<h1>`.
 *
 * ## The regression
 *
 * The first V15-10 conversions early-returned the bare panel:
 *
 *     if (!rowsResult.ok) {
 *       return <div className="…"><ListLoadFailure … /></div>;
 *     }
 *
 * which dropped the page's heading. On 17 pages a failed read produced a document with **no
 * level-1 heading at all** — the heading is how a screen-reader user knows which page they
 * are on, and it is what the panel's own `h2` is ordered against.
 *
 * ## Why the existing tests missed it
 *
 * Both looked like they covered it:
 *
 *   • `page-h1-presence.test.ts` scans a page's source for `<h1`. The *success* path still
 *     had one, so every file passed.
 *   • `error-surfaces.a11y.test.tsx` renders the panel inside `<main><h1>…</h1>` and its
 *     comment says that "is the real context". It asserted a context production never
 *     supplied — the test encoded the intended design, the pages had not implemented it.
 *
 * It took Playwright (`48-library-ops-write-smoke`, `49-hostel-ops-write-smoke`) failing on
 * `getByRole('heading', { level: 1 })` to surface it, because only a real render can tell you
 * which branch actually produced the DOM.
 *
 * ## What this asserts
 *
 * Any page that renders a list failure must do it through `ListLoadFailurePage`, which owns
 * the `h1` — or, if it renders the bare `ListLoadFailure`, must have an `<h1` inside the same
 * returned block. `health/page.tsx` is the second shape and is fine.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DASHBOARD = __dirname;

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      pageFiles(full, out);
      continue;
    }
    if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

/** Pages that render a list-load failure in any form. */
function failurePages(): { rel: string; src: string }[] {
  return pageFiles(DASHBOARD)
    .map((f) => ({ rel: f.slice(DASHBOARD.length + 1), src: readFileSync(f, 'utf8') }))
    .filter((p) => p.src.includes('ListLoadFailure'));
}

describe('a failed list read still renders the page heading', () => {
  it('finds the pages that can render a failure', () => {
    // 17 at the time of writing. Fails loudly if the glob stops matching rather than
    // asserting nothing.
    expect(failurePages().length).toBeGreaterThanOrEqual(15);
  });

  it('every failure surface carries an h1', () => {
    const offenders: string[] = [];
    for (const { rel, src } of failurePages()) {
      const viaWrapper = src.includes('<ListLoadFailurePage');
      // The bare-panel shape is only acceptable when an h1 sits beside it in the same JSX.
      const bareMatches = [...src.matchAll(/<ListLoadFailure\b(?!Page)/g)];
      if (viaWrapper && bareMatches.length === 0) continue;
      for (const m of bareMatches) {
        // Look back over the enclosing return block for an <h1.
        const before = src.slice(Math.max(0, m.index - 900), m.index);
        const blockStart = before.lastIndexOf('return (');
        const block = blockStart >= 0 ? before.slice(blockStart) : before;
        if (!block.includes('<h1')) offenders.push(`${rel} (bare panel with no <h1> above it)`);
      }
    }
    expect(
      offenders,
      'These pages drop the page heading when a list read fails. Render through ' +
        '<ListLoadFailurePage>, which owns the h1:\n' +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('the wrapper is always given a heading', () => {
    const offenders: string[] = [];
    for (const { rel, src } of failurePages()) {
      for (const m of src.matchAll(/<ListLoadFailurePage\b/g)) {
        const tag = src.slice(m.index, src.indexOf('/>', m.index));
        if (!/\bheading=/.test(tag)) offenders.push(rel);
      }
    }
    expect(
      offenders,
      `<ListLoadFailurePage> without a heading prop: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
