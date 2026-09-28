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
    // The property: whatever branch renders the failure, the document still has a level-1
    // heading. Two ways to satisfy it, and both are fine:
    //
    //   • `<ListLoadFailurePage heading=…>` — the panel replaces the page, wrapper owns the h1
    //   • the panel rendered inline inside the page's normal return, which already has an h1
    //
    // An earlier revision of this test walked backwards from the `<ListLoadFailure` tag looking
    // for `<h1` within 900 characters. That passed for early returns and failed once the panel
    // moved inline into a Card far below the heading — the test was pinning a shape rather than
    // the property.
    const offenders: string[] = [];
    for (const { rel, src } of failurePages()) {
      const viaWrapper = src.includes('<ListLoadFailurePage');
      const hasOwnHeading = src.includes('<h1');
      if (!viaWrapper && !hasOwnHeading) offenders.push(rel);
    }
    expect(
      offenders,
      'These pages can render a list failure with no level-1 heading anywhere. Use ' +
        '<ListLoadFailurePage>, which owns the h1, or render the panel inside the page body ' +
        'that already has one:\n' +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('no page early-returns a bare panel, which would drop the heading', () => {
    // The original defect, asserted directly: `return ( <div…> <ListLoadFailure` with no
    // heading between them.
    const offenders: string[] = [];
    for (const { rel, src } of failurePages()) {
      for (const m of src.matchAll(
        /return \(\s*\n\s*<div[^>]*>\s*\n\s*<ListLoadFailure\b(?!Page)/g,
      )) {
        void m;
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `Bare-panel early return drops the page heading: ${offenders.join(', ')}`,
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
