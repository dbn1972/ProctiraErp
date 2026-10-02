/**
 * @vitest-environment jsdom
 *
 * PRC-L240 — invalid allergy fields are marked aria-invalid and point at their
 * error message via aria-describedby, so screen readers announce the field.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../actions', () => ({ createAllergyAction: vi.fn() }));

import { CreateAllergyForm } from './create-allergy-form';

afterEach(cleanup);

const STUDENTS = JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', label: 'Asha' }]);

describe('CreateAllergyForm field errors (PRC-L240)', () => {
  it('announces each invalid field instead of a single generic alert', () => {
    render(<CreateAllergyForm studentOptionsJson={STUDENTS} />);
    fireEvent.submit(screen.getByTestId('create-allergy-form'));

    for (const id of ['studentId', 'allergyType', 'description']) {
      const control = document.getElementById(id)!;
      expect(control.getAttribute('aria-invalid')).toBe('true');
      const describedBy = control.getAttribute('aria-describedby') ?? '';
      expect(describedBy).toContain(`${id}-error`);
      expect(document.getElementById(`${id}-error`)?.textContent).toMatch(/required|Select/);
    }
  });

  it('every form control has an accessible label', () => {
    render(<CreateAllergyForm studentOptionsJson={STUDENTS} />);
    for (const name of ['Student', 'Allergy type', 'Description', 'Severity', 'Diagnosed date']) {
      expect(screen.getByLabelText(new RegExp(`^${name}`))).toBeTruthy();
    }
  });
});
