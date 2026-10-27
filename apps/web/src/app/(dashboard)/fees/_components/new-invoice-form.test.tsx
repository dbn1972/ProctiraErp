/**
 * @vitest-environment jsdom
 *
 * PRC-L240 — invalid invoice fields (student, ad-hoc title and amount) are
 * marked aria-invalid and point at their own error message, instead of one
 * generic form-level alert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../fees-actions', () => ({
  createFeePlanAction: vi.fn(),
  createInvoiceAction: vi.fn(),
}));

import { createInvoiceAction } from '../../fees-actions';
import { NewInvoiceForm } from './new-invoice-form';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const STUDENTS = [{ id: STUDENT_ID, label: 'Asha' }];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function expectFieldError(id: string, message: RegExp) {
  const control = document.getElementById(id)!;
  expect(control.getAttribute('aria-invalid')).toBe('true');
  expect(control.getAttribute('aria-describedby') ?? '').toContain(`${id}-error`);
  expect(document.getElementById(`${id}-error`)?.textContent).toMatch(message);
}

describe('NewInvoiceForm field errors (PRC-L240)', () => {
  it('announces the missing student and does not call the action', () => {
    const { container } = render(<NewInvoiceForm plans={[]} studentOptions={STUDENTS} />);
    fireEvent.submit(container.querySelector('form')!);

    const student = document.getElementById('invoice-student')!;
    expect(student.getAttribute('aria-invalid')).toBe('true');
    expect(student.getAttribute('aria-describedby') ?? '').toContain('invoice-student-field-error');
    expect(document.getElementById('invoice-student-field-error')?.textContent).toMatch(
      /Select a student/,
    );
    expect(createInvoiceAction).not.toHaveBeenCalled();
  });

  it('announces the ad-hoc title and amount when no plan is chosen', () => {
    const { container } = render(<NewInvoiceForm plans={[]} studentOptions={STUDENTS} />);
    fireEvent.change(document.getElementById('invoice-student')!, {
      target: { value: STUDENT_ID },
    });
    fireEvent.submit(container.querySelector('form')!);

    expect(document.getElementById('invoice-student')!.getAttribute('aria-invalid')).toBeNull();
    expectFieldError('invoice-title', /title/i);
    expectFieldError('invoice-amount', /amount/i);
    expect(createInvoiceAction).not.toHaveBeenCalled();
  });
});
