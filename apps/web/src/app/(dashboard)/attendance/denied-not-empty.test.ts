/**
 * @vitest-environment node
 *
 * UX AT-3 — attendance must not render a denial as an empty roster or an empty approval queue.
 *
 * The defect, from `docs/audits/UX_ATTENDANCE_2026-09-24.md`: `getClassRoster`,
 * `listRegularisations` and `listLeaveRequests` each discarded `status` and `error` and returned
 * `[]`, so a 403 produced:
 *
 *   • "No roster yet. Choose an institution, class, academic period, and date…"  — on the screen a
 *     teacher opens every period, indistinguishable from a class with nobody enrolled
 *   • "No regularisation requests yet." / "No leave requests yet."  — which a clerk reads as
 *     "nothing to approve", the most costly possible misreading of an approval queue
 *
 * Attendance is the highest-frequency journey in the product, so the wrong answer here is paid
 * many times a day.
 *
 * Structural rather than rendered: these are async server components calling `requireSession()`
 * and five gateway reads, so mounting them needs a session and a backend. The property that
 * matters is visible in source — does the page branch on the failure, or go straight to the
 * empty-state copy?
 *
 * Note the shape asserted here is *inline*, not an early return. The panel renders inside the
 * page body so the selection controls and request forms stay usable when only the list is
 * unreadable, and so the page's existing `h1` survives. Early-returning the panel is what caused
 * the 17-page heading regression on the V15 branch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ATTENDANCE_DIR = __dirname;
const API = join(ATTENDANCE_DIR, '..', '..', '..', 'lib', 'api', 'attendance.ts');

/** Pages whose list reads were converted, with the variable each failure is bound to. */
const CONVERTED = [
  { rel: 'page.tsx', failureVar: 'rosterFailure' },
  { rel: 'ops/page.tsx', failureVar: 'queueFailure' },
] as const;

function page(rel: string): string {
  return readFileSync(join(ATTENDANCE_DIR, rel), 'utf8');
}

describe('AT-3 the data layer preserves the reason a list is empty', () => {
  const api = readFileSync(API, 'utf8');

  it('the three collection reads return ListResult, not a bare array', () => {
    for (const fn of ['getClassRoster', 'listRegularisations', 'listLeaveRequests']) {
      const signature = new RegExp(
        `export async function ${fn}\\b[\\s\\S]{0,400}?\\)\\s*:\\s*Promise<([^>]+)>`,
      );
      const match = signature.exec(api);
      expect(match, `${fn} signature not found`).toBeTruthy();
      expect(match![1], `${fn} still returns a bare array — a 403 would collapse to []`).toContain(
        'ListResult<',
      );
    }
  });

  it('none of the three still collapses with ?? []', () => {
    // The exact shape that produced the defect: `throwOnError: false` followed by `?? []`.
    for (const fn of ['getClassRoster', 'listRegularisations', 'listLeaveRequests']) {
      const body =
        new RegExp(`export async function ${fn}\\b[\\s\\S]*?\\n\\}`).exec(api)?.[0] ?? '';
      expect(body, `${fn} still discards the failure`).not.toMatch(/\?\?\s*\[\]/);
      expect(body, `${fn} still opts out of error reporting`).not.toContain('throwOnError: false');
    }
  });
});

describe('AT-3 the pages say why a list is empty', () => {
  for (const { rel, failureVar } of CONVERTED) {
    it(`${rel} branches on the failed read and renders ListLoadFailure`, () => {
      const src = page(rel);
      expect(src, `${rel} does not render ListLoadFailure`).toContain('<ListLoadFailure');
      expect(src, `${rel} does not derive a failure from the result`).toMatch(
        new RegExp(`const ${failureVar}\\s*=`),
      );
      expect(src, `${rel}: no kind passed`).toMatch(/kind=\{\w+\.kind\}/);
      expect(src, `${rel}: no status passed`).toMatch(/status=\{\w+\.status\}/);
    });

    it(`${rel} keeps its page heading when the read fails`, () => {
      // Inline, not an early return: the panel must not replace the page.
      const src = page(rel);
      expect(src, `${rel} has no <h1>`).toContain('<h1');
      expect(
        src,
        `${rel} early-returns the bare panel, which would drop the heading and the forms`,
      ).not.toMatch(/return \(\s*\n\s*<div[^>]*>\s*\n\s*<ListLoadFailure\b/);
    });

    it(`${rel} does not read .items off a possibly-failed result`, () => {
      const src = page(rel);
      // `x.ok ? x.items : []` is fine; a bare `xResult.items` is not.
      const bare = [...src.matchAll(/(\w+Result)\.items/g)].filter((m) => {
        const before = src.slice(Math.max(0, m.index - 60), m.index);
        return !/\.ok\s*\?\s*$/.test(before);
      });
      expect(
        bare.map((m) => m[0]),
        `${rel} reads .items without checking .ok`,
      ).toEqual([]);
    });
  }

  it('the roster empty state is still reachable for a genuine empty selection', () => {
    // `ok: true, items: []` is "nothing selected yet" and must keep the first-use copy, or the
    // fix would trade a misleading empty state for a misleading error.
    const src = page('page.tsx');
    expect(src).toMatch(/ok:\s*true,\s*items:\s*\[\]/);
  });
});
