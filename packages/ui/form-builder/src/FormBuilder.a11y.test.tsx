import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormBuilder } from './FormBuilder';
import type { FormSchema } from './types';

const schema: FormSchema = {
  sections: [
    {
      title: 'S',
      fields: [
        {
          name: 'gender',
          label: 'Gender',
          type: 'radio',
          helpText: 'As on birth certificate',
          options: [
            { label: 'Female', value: 'f' },
            { label: 'Male', value: 'm' },
          ],
          validation: [{ type: 'required', message: 'Choose a gender' }],
        },
        {
          name: 'agree',
          label: 'I agree',
          type: 'checkbox',
          validation: [{ type: 'required', message: 'You must agree' }],
        },
      ],
    },
  ],
};

describe('FormBuilder group error semantics (PRC-L518)', () => {
  it('exposes required/invalid/description on the radio group and summarises errors', async () => {
    render(<FormBuilder schema={schema} onSubmit={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: /gender/i });
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(group).toHaveAttribute('aria-invalid', 'false');
    expect(group.querySelector('legend .proctira-form__required')).not.toBeNull();
    expect(screen.queryByText('There is a problem')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    const error = await screen.findByText('Choose a gender', { selector: 'p' });
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).not.toHaveAttribute('aria-live');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group.getAttribute('aria-describedby')?.split(' ')).toEqual(
      expect.arrayContaining(['field-gender-help', 'field-gender-error']),
    );

    // Focus moves to the first invalid control (first radio of the group).
    await waitFor(() => expect(screen.getByLabelText('Female')).toHaveFocus());

    const summary = screen.getByRole('heading', { name: 'There is a problem' });
    expect(summary).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /I agree: You must agree/ });
    fireEvent.click(link);
    expect(screen.getByRole('checkbox', { name: /I agree/ })).toHaveFocus();
  });
});
