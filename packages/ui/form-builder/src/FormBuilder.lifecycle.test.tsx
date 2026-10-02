import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormBuilder } from './FormBuilder';
import type { FormSchema } from './types';

const schema: FormSchema = {
  sections: [{ title: 'S', fields: [{ name: 'name', label: 'Name', type: 'text' }] }],
};

describe('FormBuilder lifecycle (PRC-L517)', () => {
  it('populates inputs when defaultValues load after mount', async () => {
    const { rerender } = render(<FormBuilder schema={schema} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Name')).toHaveValue('');
    rerender(<FormBuilder schema={schema} onSubmit={vi.fn()} defaultValues={{ name: 'Asha' }} />);
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Asha'));
  });

  it('does not reset user input when an equal inline defaultValues object is passed again', () => {
    const { rerender } = render(
      <FormBuilder schema={schema} onSubmit={vi.fn()} defaultValues={{ name: 'A' }} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'edited' } });
    rerender(<FormBuilder schema={schema} onSubmit={vi.fn()} defaultValues={{ name: 'A' }} />);
    expect(screen.getByLabelText('Name')).toHaveValue('edited');
  });

  it('shows an alert and re-enables submit when onSubmit rejects', async () => {
    const onSubmitError = vi.fn();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Server unavailable'));
    render(<FormBuilder schema={schema} onSubmit={onSubmit} onSubmitError={onSubmitError} />);
    const submit = screen.getByRole('button', { name: 'Submit' });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(onSubmitError).toHaveBeenCalledWith(expect.any(Error));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled());
  });

  it('clears the submit error on a successful retry', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce('boom').mockResolvedValueOnce(undefined);
    render(<FormBuilder schema={schema} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
