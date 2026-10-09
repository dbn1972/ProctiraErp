/**
 * Honesty-copy regression guards.
 *
 * These assert that UI copy which overstated unimplemented behaviour, and dead
 * controls, have been removed from the shipped pages:
 *   • PRC-M093 — special-needs page no longer claims accommodations are applied
 *     automatically / schools are notified.
 *   • PRC-M112 — scholarship disbursements page no longer claims PFMS
 *     reconciliation and has no dead "New batch" button.
 *   • PRC-M122 — payroll export panel no longer calls deductions a placeholder.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

describe('honesty copy guards', () => {
  it('PRC-M093: special-needs page drops the auto-applied / notified claim', () => {
    const src = read('./health/special-needs/page.tsx');
    expect(src).not.toContain('Accommodations are binding');
    expect(src).not.toContain('applied automatically');
    expect(src).not.toContain('Schools are notified of every change');
  });

  it('PRC-M112: disbursements page drops the PFMS claim and the dead New batch button', () => {
    const src = read('./scholarships/disbursements/page.tsx');
    expect(src).not.toContain('reconciled against PFMS');
    // The dead CTA button rendered the label on its own JSX line.
    expect(src).not.toMatch(/\n\s*New batch\s*\n/);
  });

  it('PRC-M122: payroll panel no longer calls deductions a placeholder', () => {
    const src = read('./staff/_components/payroll-export-panel.tsx');
    expect(src).not.toContain('Deductions are a placeholder');
  });

  it('PRC-L055: staff/new drops the unsupported employee-ID / BEO claim', () => {
    const src = read('./staff/new/page.tsx');
    expect(src).not.toContain('An employee ID is\n            generated on save');
    expect(src).not.toContain('routed to the BEO for verification');
    expect(src).not.toContain('employee ID is generated on save');
  });
});
