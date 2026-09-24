/**
 * @vitest-environment node
 *
 * V15-10 (hostel) — every page in this domain must report *why* a list is empty.
 *
 * The defect these pages had: `listHostels()` and friends swallowed 401/403/404/5xx and
 * returned `[]`, so a denial, an outage and a genuinely empty hostel all rendered as
 * "No hostels yet." A user could not tell whether to ask for access, wait, or add a record.
 *
 * Asserting this structurally rather than by rendering each page: these are async server
 * components that call `requireSession()` and `getTranslations()`, so mounting them in a test
 * would need a session, a locale and a gateway. The property that actually matters is
 * reachable from source — does the page branch on the failure at all, or does it go straight
 * to `.length`? That is exactly the mistake the drift ratchet cannot see, because the ratchet
 * measures the data layer and this measures the screen.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const HOSTEL_DIR = __dirname;

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

describe('V15-10 hostel: a denied list is not rendered as an empty one', () => {
  const pages = pageFiles(HOSTEL_DIR);

  it('finds the whole domain', () => {
    // Nine pages at the time of conversion. A new one must be converted too, and this
    // fails loudly if the glob stops matching rather than silently asserting nothing.
    expect(pages.length).toBeGreaterThanOrEqual(9);
  });

  it('every page renders ListLoadFailure for its primary list', () => {
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(HOSTEL_DIR.length + 1);
      expect(src, `${rel} does not render ListLoadFailure`).toContain('<ListLoadFailure');
      // Two shapes are legitimate. An early return guards the whole page when the read is
      // the page's only subject; an inline `const failure = ….ok ? null : …` keeps the page's
      // forms usable and swaps the panel in where the table was. Both branch on `.ok`, which
      // is the property that matters — asserting one syntax is how this test started failing
      // when the pages got better.
      expect(src, `${rel} does not branch on a failed read`).toMatch(
        /if \([^)]*!\w+(Result)?\.ok\)|\w+Result\.ok \? null :/,
      );
    }
  });

  it('passes the failure kind, status and request id through to the panel', () => {
    // Kind alone renders the right copy; status and requestId are what make a support
    // conversation start from a fact rather than "it said no records".
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(HOSTEL_DIR.length + 1);
      expect(src, `${rel}: no kind`).toMatch(/kind=\{\w+\.kind\}/);
      expect(src, `${rel}: no status`).toMatch(/status=\{\w+\.status\}/);
      expect(src, `${rel}: no requestId`).toMatch(/requestId=\{\w+\.requestId\}/);
    }
  });

  it('renders the panel in the request locale', () => {
    // V15-17: the panel takes its copy as a prop from a server helper. Forgetting it is
    // silent — the English default renders — so it is asserted rather than assumed.
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(HOSTEL_DIR.length + 1);
      expect(src, `${rel}: panel is not localised`).toContain('await getListFailureCopy()');
    }
  });

  it('no page reads .length or .map straight off a ListResult', () => {
    // The shape that would compile only because someone reached for `itemsOrEmpty` on the
    // page's subject, which is the collapse moved rather than removed.
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(HOSTEL_DIR.length + 1);
      expect(src, `${rel}: reads .length off a Result`).not.toMatch(/\w+Result\.length/);
      expect(src, `${rel}: maps over a Result`).not.toMatch(/\w+Result\.map\(/);
    }
  });

  it('documents every itemsOrEmpty as a supporting lookup', () => {
    // `itemsOrEmpty` is legitimate for a dropdown feeding a form, and illegitimate for the
    // list the page is about. The difference is a judgement, so it has to be written down
    // where the next reader will see it.
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes('itemsOrEmpty(')) continue;
      const rel = file.slice(HOSTEL_DIR.length + 1);
      expect(src, `${rel}: itemsOrEmpty with no stated reason`).toMatch(/Supporting lookups? for/);
    }
  });
});
