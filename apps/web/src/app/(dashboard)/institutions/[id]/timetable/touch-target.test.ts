/**
 * PRC-L045 — timetable header actions must not override the 44px touch-target
 * rule, and the live touch-target spec must walk this page.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
const SPEC = readFileSync(
  path.resolve(__dirname, '../../../../../../e2e/touch-target-minimum.spec.ts'),
  'utf8',
);

describe('timetable touch targets (PRC-L045)', () => {
  it('has no important height/min-height overrides on action buttons', () => {
    expect(PAGE).not.toMatch(/!h-8|!min-h-8|!min-w-0/);
    expect(PAGE).toContain('min-h-11');
  });

  it('is covered by the touch-target-minimum e2e spec', () => {
    expect(SPEC).toContain('`/institutions/${E2E_INSTITUTION_ID}/timetable`,');
  });
});
