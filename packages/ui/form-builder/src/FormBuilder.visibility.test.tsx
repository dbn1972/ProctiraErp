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
          name: 'hasSibling',
          label: 'Has sibling',
          type: 'select',
          options: [
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
          ],
        },
        {
          name: 'siblingName',
          label: 'Sibling name',
          type: 'text',
          visibleWhen: { field: 'hasSibling', value: 'yes' },
        },
        { name: 'grade', label: 'Grade', type: 'select', options: [{ label: '1', value: '1' }] },
        {
          name: 'gradeNote',
          label: 'Grade note',
          type: 'text',
          visibleWhen: { field: 'grade', value: 1 },
        },
        { name: 'consent', label: 'Consent', type: 'checkbox' },
        {
          name: 'consentBy',
          label: 'Consent by',
          type: 'text',
          visibleWhen: { field: 'consent', value: true },
        },
        {
          name: 'notNo',
          label: 'Not no',
          type: 'text',
          visibleWhen: { field: 'hasSibling', value: 'no', operator: 'neq' },
        },
        {
          name: 'inList',
          label: 'In list',
          type: 'text',
          visibleWhen: { field: 'hasSibling', value: ['yes', 'maybe'], operator: 'in' },
        },
      ],
    },
  ],
};

describe('visibleWhen (PRC-L516)', () => {
  it('drops values of fields hidden after toggling the controlling field', async () => {
    const onSubmit = vi.fn();
    render(<FormBuilder schema={schema} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Has sibling'), { target: { value: 'yes' } });
    fireEvent.change(await screen.findByLabelText('Sibling name'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Has sibling'), { target: { value: 'no' } });
    await waitFor(() => expect(screen.queryByLabelText('Sibling name')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('siblingName');
    expect(payload).not.toHaveProperty('inList');
    expect(payload['hasSibling']).toBe('no');
  });

  it('matches numeric and boolean visibleWhen values loosely', async () => {
    render(<FormBuilder schema={schema} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Grade note')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Consent by')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Grade'), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('Consent'));
    expect(await screen.findByLabelText('Grade note')).toBeInTheDocument();
    expect(await screen.findByLabelText('Consent by')).toBeInTheDocument();
  });

  it('supports neq and in operators', async () => {
    render(<FormBuilder schema={schema} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Not no')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Has sibling'), { target: { value: 'yes' } });
    expect(await screen.findByLabelText('In list')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Has sibling'), { target: { value: 'no' } });
    await waitFor(() => expect(screen.queryByLabelText('Not no')).not.toBeInTheDocument());
  });
});
