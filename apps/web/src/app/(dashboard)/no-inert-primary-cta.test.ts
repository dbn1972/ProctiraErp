/**
 * G-925 — no inert primary CTAs.
 *
 * A `<Button disabled>` with an unconditional `disabled` attribute and no
 * `title=` explaining why is a dead control: it looks actionable but never
 * does anything. Every such button must either be wired or carry a reason.
 * Conditional `disabled={...}` (pending / validation state) is fine.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '__tests') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** `<Button ... disabled ...>` where `disabled` is a bare boolean attribute. */
const BUTTON_OPEN_TAG = /<Button\b[^>]*?>/g;
const BARE_DISABLED = /(^|\s)disabled(\s|>|$)/;
const HAS_REASON = /\btitle=/;

describe('G-925 — dashboard primary CTAs are never inert', () => {
  it('has no <Button disabled> without a title reason under (dashboard)', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(BUTTON_OPEN_TAG)) {
        const tag = match[0];
        if (BARE_DISABLED.test(tag) && !HAS_REASON.test(tag)) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${relative(ROOT, file)}:${line}`);
        }
      }
    }
    expect(offenders, `Inert primary CTAs:\n${offenders.join('\n')}`).toEqual([]);
  });
});
