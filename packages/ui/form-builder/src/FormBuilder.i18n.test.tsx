import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FormBuilder } from './FormBuilder';
import type { FormSchema } from './types';

describe('FormBuilder labels and nested names (PRC-L519)', () => {
  it('shows the error for a required dotted-name field', async () => {
    const schema: FormSchema = {
      sections: [
        {
          title: 'Address',
          fields: [
            {
              name: 'address.city',
              label: 'City',
              type: 'text',
              validation: [{ type: 'required', message: 'City is required' }],
            },
          ],
        },
      ],
    };
    render(<FormBuilder schema={schema} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('City is required', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByLabelText(/City/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('localises built-in strings via labels', async () => {
    const schema: FormSchema = {
      sections: [
        {
          title: 'S',
          fields: [
            {
              name: 'cls',
              label: 'Classe',
              type: 'select',
              options: [{ label: 'A', value: 'a' }],
              validation: [{ type: 'required', message: 'Obligatoire' }],
            },
          ],
        },
      ],
    };
    render(
      <FormBuilder
        schema={schema}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        labels={{
          selectPlaceholder: 'Choisir…',
          submit: 'Envoyer',
          cancel: 'Annuler',
          errorSummaryTitle: 'Il y a un problème',
        }}
      />,
    );
    expect(screen.getByRole('option', { name: 'Choisir…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(await screen.findByRole('heading', { name: 'Il y a un problème' })).toBeInTheDocument();
  });
});
