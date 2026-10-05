/**
 * PRC-M117 — the staff profile honours ?tab= from post-save redirects and
 * the Apply-for-leave link targets an existing route with the staff preselected.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveProfileTab } from './profile-tab';

describe('staff profile tab + leave link (PRC-M117)', () => {
  it('?tab=appraisals selects the Appraisals tab; unknown values fall back', () => {
    expect(resolveProfileTab('appraisals')).toBe('appraisals');
    expect(resolveProfileTab('assignments')).toBe('assignments');
    expect(resolveProfileTab('nope')).toBe('overview');
    expect(resolveProfileTab(['appraisals'])).toBe('overview');
    expect(resolveProfileTab(undefined)).toBe('overview');
  });

  it('profile uses the resolved tab and links to /staff/leaves?staffId=', () => {
    const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(src).toContain('<Tabs defaultValue={initialTab}>');
    expect(src).toContain('/staff/leaves?staffId=');
    expect(src).not.toContain('/leaves/new');
  });
});
