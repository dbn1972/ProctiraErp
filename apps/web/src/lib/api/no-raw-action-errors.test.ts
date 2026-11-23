/**
 * RAW-WEB / D1-T2..T6 guard: server actions and the listed pages never put gateway or server
 * error text on screen. They use `genericActionErrorMessage` / `genericResultErrorMessage`
 * (fixed copy plus a reference) instead. This scans the sources for the forwarding patterns
 * the fix removed, so a new action cannot quietly reintroduce them.
 *
 * Out of scope here: `(dashboard)/health/**` (fixed by its own PR).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
const SRC = join(__dirname, '..', '..');
const EXCLUDED = [/\/\(dashboard\)\/health\//];
/** Extra non-action files from the D1 report that rendered raw server text. */
const EXTRA_FILES = [
  'app/(parent)/parent/offers/page.tsx',
  'app/(parent)/parent/scholarships/_components/parent-scholarship-apply.tsx',
  'app/(dashboard)/institutions/[id]/gradebook/report-cards/[jobId]/page.tsx',
  'app/(dashboard)/academic-periods/page.tsx',
  'app/(dashboard)/academic-periods/[id]/calendar/page.tsx',
  'app/(dashboard)/institutions/page.tsx',
  'app/(dashboard)/institutions/error.tsx',
  'app/(dashboard)/institutions/[id]/classes/page.tsx',
  'app/(dashboard)/institutions/[id]/grades/page.tsx',
  'app/(dashboard)/institutions/[id]/infrastructure/page.tsx',
  'app/(dashboard)/institutions/[id]/overview/page.tsx',
  'app/(dashboard)/institutions/[id]/timetable/page.tsx',
  'app/(dashboard)/institutions/[id]/timetable/error.tsx',
  'lib/api/admissions.ts',
  'lib/api/communication.ts',
];
const FORBIDDEN: Array<[string, RegExp]> = [
  [
    'GatewayError message forwarded',
    /instanceof (?:Browser)?GatewayError\s*\?\s*(?:error|err|e)\.message/,
  ],
  ['Error message forwarded', /instanceof Error\s*\?\s*(?:error|err|e)\.message/],
  ['message || fallback', /\b(?:error|err)\.message\s*\|\|/],
  ['message property from error', /\b(?:message|error|reason):\s*(?:error|err)\.message\b/],
  ['returns error.message', /return (?:error|err)\.message;/],
  ['result.error.message forwarded', /result\.error\?\.message/],
  ['legacy helper', /safeActionErrorMessage/],
  ['ApiClientError message shown', /instanceof ApiClientError\s*\?\s*error\.message/],
  ['error.message rendered', /\{(?:props\.)?error\.message\b/],
  ['job.errorMessage rendered', /\$\{job\.errorMessage\}/],
];
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/actions?\.ts$|-actions\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}
const files = [
  ...walk(join(SRC, 'app')),
  ...walk(join(SRC, 'lib')),
  ...EXTRA_FILES.map((f) => join(SRC, f)),
].filter((f) => !EXCLUDED.some((re) => re.test(f)));
describe('no raw server error text in actions and listed pages (RAW-WEB, D1-T2..T6)', () => {
  it('scans a meaningful set of files', () => {
    expect(files.length).toBeGreaterThan(30);
  });
  it.each(files.map((f) => [relative(SRC, f), f]))('%s', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    const hits = FORBIDDEN.filter(([, re]) => re.test(source)).map(([label]) => label);
    expect(hits).toEqual([]);
  });
});
