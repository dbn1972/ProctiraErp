/**
 * PRC-L042 — help shortcuts match real handlers; withdrawn enrolments are not
 * styled as enrolled; hostel attendance "today" uses the tenant timezone.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('PRC-L042 UI accuracy', () => {
  it("help does not list a '/' shortcut that no handler implements", () => {
    expect(read('help/page.tsx')).not.toMatch(/keys:\s*'\/'/);
  });

  it('withdrawn enrolment pill uses a neutral colour', () => {
    const src = read('institutions/[id]/schedule/[sectionId]/page.tsx');
    expect(src).toContain("e.status === 'ENROLLED'");
    expect(src).toContain("'bg-muted text-muted-foreground'");
    expect(src).not.toContain(
      'className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700"',
    );
  });

  it('hostel attendance computes today in the tenant timezone', () => {
    const src = read('hostel/attendance/page.tsx');
    expect(src).toContain('getTenantToday()');
    expect(src).not.toContain('new Date().toISOString().slice(0, 10)');
  });
});
