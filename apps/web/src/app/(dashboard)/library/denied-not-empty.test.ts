/**
 * @vitest-environment node
 *
 * V15-10 (library) — every page in this domain must report *why* a list is empty.
 *
 * The defect: `listLibraryItems()` and friends swallowed 401/403/404/5xx and returned `[]`,
 * so "No holdings", "No fines yet" and "No overdues" were each indistinguishable from a
 * denial or an outage.
 *
 * This domain is the clearest case in the product for why that matters. An empty catalogue
 * is *plausible* on a newly provisioned tenant, so a librarian seeing "No holdings" has no
 * reason to suspect a permission problem — unlike, say, an empty student list. And "No fines
 * yet" / "No overdues" are answers a bursar acts on: a denied read impersonating them says
 * the ledger is clear when nobody actually looked.
 *
 * Structural rather than rendered, for the same reason as the hostel suite: these are async
 * server components that call `requireSession()` and `getTranslations()`, so mounting them
 * needs a session, a locale and a gateway. The property that matters is visible in source —
 * does the page branch on the failure, or go straight to `.length`?
 *
 * The two portal pages are covered separately below: they render inside `AcademicFrame`
 * rather than `ListLoadFailure`, which is deliberate and is asserted as such.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LIBRARY_DIR = __dirname;
/** `src/app`, two levels up from `src/app/(dashboard)/library`. */
const APP_DIR = join(LIBRARY_DIR, '..', '..');

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

/** Pages whose primary list read is a converted `library.ts` function. */
const CONVERTED_DASHBOARD_PAGES = [
  'page.tsx',
  'circulation/page.tsx',
  'fines/page.tsx',
  'holds/page.tsx',
  'opac/page.tsx',
  'overdues/page.tsx',
];

describe('V15-10 library: a denied list is not rendered as an empty one', () => {
  const pages = pageFiles(LIBRARY_DIR).filter((f) => {
    const rel = f.slice(LIBRARY_DIR.length + 1);
    return CONVERTED_DASHBOARD_PAGES.includes(rel);
  });

  it('finds every converted page in the domain', () => {
    // Fails loudly if a path changes, rather than silently asserting nothing. `[id]/page.tsx`
    // is excluded on purpose: it is a single-record read, not a list.
    expect(pages.map((f) => f.slice(LIBRARY_DIR.length + 1)).sort()).toEqual(
      [...CONVERTED_DASHBOARD_PAGES].sort(),
    );
  });

  it('every page renders ListLoadFailure for its primary list', () => {
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(LIBRARY_DIR.length + 1);
      expect(src, `${rel} does not render ListLoadFailure`).toContain('<ListLoadFailure');
      expect(src, `${rel} does not branch on a failed read`).toMatch(
        /if \([^)]*!\w+(Result)?\.ok\)/,
      );
    }
  });

  it('passes the failure kind, status and request id through to the panel', () => {
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(LIBRARY_DIR.length + 1);
      expect(src, `${rel}: no kind`).toMatch(/kind=\{\w+\.kind\}/);
      expect(src, `${rel}: no status`).toMatch(/status=\{\w+\.status\}/);
      expect(src, `${rel}: no requestId`).toMatch(/requestId=\{\w+\.requestId\}/);
    }
  });

  it('renders the panel in the request locale', () => {
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(LIBRARY_DIR.length + 1);
      expect(src, `${rel}: panel is not localised`).toContain('await getListFailureCopy()');
    }
  });

  it('no page reads .length or .map straight off a ListResult', () => {
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(LIBRARY_DIR.length + 1);
      expect(src, `${rel}: reads .length off a Result`).not.toMatch(/\w+Result\.length/);
      expect(src, `${rel}: maps over a Result`).not.toMatch(/\w+Result\.map\(/);
    }
  });

  it('documents every itemsOrEmpty as a supporting lookup', () => {
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes('itemsOrEmpty(')) continue;
      const rel = file.slice(LIBRARY_DIR.length + 1);
      expect(src, `${rel}: itemsOrEmpty with no stated reason`).toMatch(/Supporting lookups? for/);
    }
  });

  it('the OPAC tells "not searched yet" apart from "search failed"', () => {
    // The old code was `query ? await searchLibraryOpac(query) : []`, which made an
    // unvisited search box and a failed search render the same thing.
    const src = readFileSync(join(LIBRARY_DIR, 'opac/page.tsx'), 'utf8');
    expect(src).toMatch(/query \? await searchLibraryOpac\(query\) : null/);
  });
});

describe('V15-10 library: the parent and student portals report denial too', () => {
  // These render inside `AcademicFrame`, which already had `forbidden` and `error` states
  // that nothing could reach because the data layer had flattened the reason first.
  const PORTAL_PAGES = [
    join(APP_DIR, '(parent)', 'parent', 'library', 'page.tsx'),
    join(APP_DIR, '(student)', 'student', 'library', 'page.tsx'),
  ];

  it('both portal pages exist where this test expects them', () => {
    for (const file of PORTAL_PAGES) {
      expect(() => readFileSync(file, 'utf8'), file).not.toThrow();
    }
  });

  it('maps the failure kind onto the frame instead of collapsing to empty', () => {
    for (const file of PORTAL_PAGES) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file}: no status mapping`).toContain('academicFrameStatusFor(');
      // Narrowed per-result, because TypeScript cannot correlate a combined `failed`
      // variable back to the two reads.
      expect(src, `${file}: loans failure not handled`).toMatch(/if \(!loansResult\.ok\)/);
      expect(src, `${file}: holds failure not handled`).toMatch(/if \(!holdsResult\.ok\)/);
    }
  });

  it('quotes the status and request id so support has a fact to work from', () => {
    for (const file of PORTAL_PAGES) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file}: no status in the message`).toMatch(/status \$\{failure\.status\}/);
      expect(src, `${file}: no requestId in the message`).toContain('failure.requestId');
    }
  });

  it('keeps the catalogue search secondary to the borrowing record', () => {
    // A failed OPAC search must not blank the page: loans and holds are why a guardian or
    // student opened it, and those are reported separately above.
    for (const file of PORTAL_PAGES) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file}: search failure not kept secondary`).toMatch(
        /itemsResult\.ok \? itemsResult\.items : \[\]/,
      );
    }
  });
});
