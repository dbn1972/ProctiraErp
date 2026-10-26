/**
 * @vitest-environment jsdom
 *
 * PRC-L240 — invalid fee-plan fields are marked aria-invalid and point at
 * their own error message, instead of one generic form-level alert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../fees-actions', () => ({
  createFeePlanAction: vi.fn(),
  createInvoiceAction: vi.fn(),
}));

import { createFeePlanAction } from '../../fees-actions';
import { NewFeePlanForm } from './new-fee-plan-form';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NewFeePlanForm field errors (PRC-L240)', () => {
  it('announces each invalid field and does not call the action', () => {
    const { container } = render(<NewFeePlanForm />);
    fireEvent.change(document.getElementById('plan-amount')!, { target: { value: '-1' } });
    fireEvent.submit(container.querySelector('form')!);

    const expected: Record<string, RegExp> = {
      'plan-name': /Name is required/,
      'plan-amount': /non-negative amount/,
    };
    for (const [id, message] of Object.entries(expected)) {
      const control = document.getElementById(id)!;
      expect(control.getAttribute('aria-invalid')).toBe('true');
      expect(control.getAttribute('aria-describedby') ?? '').toContain(`${id}-error`);
      expect(document.getElementById(`${id}-error`)?.textContent).toMatch(message);
    }
    expect(createFeePlanAction).not.toHaveBeenCalled();
  });

  it('an empty amount is treated as 0 (unchanged), so only the name is flagged', () => {
    const { container } = render(<NewFeePlanForm />);
    fireEvent.submit(container.querySelector('form')!);

    expect(document.getElementById('plan-name')!.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('plan-amount')!.getAttribute('aria-invalid')).toBeNull();
    expect(createFeePlanAction).not.toHaveBeenCalled();
  });

  it('flags only the amount when the name is present', () => {
    const { container } = render(<NewFeePlanForm />);
    fireEvent.change(document.getElementById('plan-name')!, { target: { value: 'Tuition' } });
    fireEvent.change(document.getElementById('plan-amount')!, { target: { value: '-5' } });
    fireEvent.submit(container.querySelector('form')!);

    expect(document.getElementById('plan-name')!.getAttribute('aria-invalid')).toBeNull();
    expect(document.getElementById('plan-amount')!.getAttribute('aria-invalid')).toBe('true');
    expect(createFeePlanAction).not.toHaveBeenCalled();
  });
});
