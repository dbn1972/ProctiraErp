import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { FormBuilder } from './FormBuilder';
import type { FormSchema, ValidationRule } from './types';

/** PRC-L514: custom rules run, unknown rules are loud, required:false is honoured. */
function schemaWith(validation: ValidationRule[]): FormSchema {
  return {
    sections: [{ title: 'S', fields: [{ name: 'code', label: 'Code', type: 'text', validation }] }],
    submitLabel: 'Save',
  };
}

describe('FormBuilder validation rules (PRC-L514)', () => {
  it('blocks submit when a custom validator fails and shows its message', async () => {
    const onSubmit = vi.fn();
    render(
      <FormBuilder
        schema={schemaWith([{ type: 'custom', value: 'even', message: 'Must be even' }])}
        validators={{ even: (v) => Number(v) % 2 === 0 }}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Must be even')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('throws in dev/test for an unknown rule type', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = { type: 'bogus', message: 'x' } as unknown as ValidationRule;
    expect(() => render(<FormBuilder schema={schemaWith([bad])} onSubmit={vi.fn()} />)).toThrow(
      /Unknown validation rule type "bogus"/,
    );
    spy.mockRestore();
  });

  it('throws in dev/test when a custom rule names no registered validator', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <FormBuilder
          schema={schemaWith([{ type: 'custom', value: 'missing', message: 'x' }])}
          onSubmit={vi.fn()}
        />,
      ),
    ).toThrow(/No validator registered for custom rule "missing"/);
    spy.mockRestore();
  });

  it('honours required: false', async () => {
    const onSubmit = vi.fn();
    render(
      <FormBuilder
        schema={schemaWith([{ type: 'required', value: false, message: 'Required' }])}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText('Code')).not.toHaveAttribute('aria-required');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Required')).toBeNull();
  });
});
