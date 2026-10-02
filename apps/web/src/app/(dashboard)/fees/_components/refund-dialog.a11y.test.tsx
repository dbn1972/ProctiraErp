/**
 * @vitest-environment jsdom
 *
 * PRC-L240 — refund/concession dialog fields expose field-level errors, and
 * the dunning bulk controls carry a group label.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('@/lib/fees/actions', () => ({
  refundInvoiceAction: vi.fn(),
  applyConcessionAction: vi.fn(async () => ({
    success: false,
    error: 'Validation failed',
    fieldErrors: [{ field: 'percent', message: 'Enter a percent greater than 0 and at most 100' }],
  })),
}));

import { RefundDialog } from './refund-dialog';
import { ConcessionDialog } from './concession-dialog';

afterEach(cleanup);
const ID = '11111111-1111-4111-8111-111111111111';

describe('fees dialogs field errors (PRC-L240)', () => {
  it('refund: blank reason marks the reason field invalid with a described error', () => {
    render(<RefundDialog invoiceId={ID} amountCents={1000} />);
    fireEvent.click(screen.getByTestId('open-refund'));
    const reason = screen.getByLabelText(/^Reason/) as HTMLInputElement;
    reason.removeAttribute('required');
    fireEvent.submit(screen.getByTestId('refund-form'));
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    expect(reason.getAttribute('aria-describedby')).toContain('refund-reason-error');
    expect(document.getElementById('refund-reason-error')?.textContent).toMatch(/required/);
  });

  it('concession: server field error is shown on the percent input', async () => {
    render(<ConcessionDialog studentId={ID} structureId={ID} invoiceId={ID} />);
    fireEvent.click(screen.getByTestId('open-concession'));
    fireEvent.submit(screen.getByTestId('concession-form'));
    const err = await screen.findByText(/percent greater than 0/);
    expect(err.id).toBe('concession-percent-error');
    expect(screen.getByLabelText(/^Percent/).getAttribute('aria-invalid')).toBe('true');
  });

  it('dunning bulk controls have a group legend and labelled table', () => {
    const src = readFileSync(resolve(__dirname, 'dunning-console.tsx'), 'utf8');
    expect(src).toMatch(/<legend className="sr-only">Reminder channels<\/legend>/);
    expect(src).toMatch(/aria-label="Overdue invoices/);
  });
});
