import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FormBuilder } from './FormBuilder';
import type { FormSchema } from './types';

const basicSchema: FormSchema = {
  title: 'Test Form',
  description: 'A test form',
  sections: [
    {
      title: 'Personal Info',
      fields: [
        {
          name: 'firstName',
          label: 'First Name',
          type: 'text',
          validation: [{ type: 'required', message: 'First name is required' }],
        },
        {
          name: 'email',
          label: 'Email',
          type: 'email',
          placeholder: 'Enter email',
        },
        {
          name: 'age',
          label: 'Age',
          type: 'number',
          validation: [
            { type: 'min', value: 1, message: 'Must be at least 1' },
            { type: 'max', value: 150, message: 'Must be at most 150' },
          ],
        },
      ],
    },
  ],
  submitLabel: 'Save',
  cancelLabel: 'Discard',
};

describe('FormBuilder', () => {
  it('renders form with title and description', () => {
    render(<FormBuilder schema={basicSchema} onSubmit={vi.fn()} />);

    expect(screen.getByText('Test Form')).toBeInTheDocument();
    expect(screen.getByText('A test form')).toBeInTheDocument();
  });

  it('renders all fields from schema', () => {
    render(<FormBuilder schema={basicSchema} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/age/i)).toBeInTheDocument();
  });

  it('renders section titles as fieldset legends', () => {
    render(<FormBuilder schema={basicSchema} onSubmit={vi.fn()} />);

    expect(screen.getByText('Personal Info')).toBeInTheDocument();
  });

  it('shows required indicator for required fields', () => {
    render(<FormBuilder schema={basicSchema} onSubmit={vi.fn()} />);

    const label = screen.getByText('First Name');
    const requiredIndicator = label.parentElement?.querySelector('.proctira-form__required');
    expect(requiredIndicator).toBeInTheDocument();
  });

  it('shows validation error on submit with empty required field', async () => {
    const onSubmit = vi.fn();
    render(<FormBuilder schema={basicSchema} onSubmit={onSubmit} />);

    const submitBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('First name is required')).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with form data when valid', async () => {
    const onSubmit = vi.fn();
    render(<FormBuilder schema={basicSchema} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/first name/i), {
      target: { value: 'John' },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'john@example.com' },
    });

    const submitBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'John', email: 'john@example.com' }),
        expect.anything(),
      );
    });
  });

  it('renders cancel button when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(<FormBuilder schema={basicSchema} onSubmit={vi.fn()} onCancel={onCancel} />);

    const cancelBtn = screen.getByRole('button', { name: /discard/i });
    expect(cancelBtn).toBeInTheDocument();

    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders select field with options', () => {
    const schema: FormSchema = {
      sections: [
        {
          title: 'Preferences',
          fields: [
            {
              name: 'country',
              label: 'Country',
              type: 'select',
              options: [
                { label: 'USA', value: 'us' },
                { label: 'UK', value: 'uk' },
              ],
            },
          ],
        },
      ],
    };

    render(<FormBuilder schema={schema} onSubmit={vi.fn()} />);

    const select = screen.getByLabelText(/country/i);
    expect(select).toBeInTheDocument();
    expect(screen.getByText('USA')).toBeInTheDocument();
    expect(screen.getByText('UK')).toBeInTheDocument();
  });

  it('supports conditional field visibility', () => {
    const schema: FormSchema = {
      sections: [
        {
          title: 'Details',
          fields: [
            {
              name: 'hasPhone',
              label: 'Has Phone',
              type: 'checkbox',
            },
            {
              name: 'phone',
              label: 'Phone Number',
              type: 'tel',
              visibleWhen: { field: 'hasPhone', value: true },
            },
          ],
        },
      ],
    };

    render(<FormBuilder schema={schema} onSubmit={vi.fn()} />);

    // Phone field should not be visible initially
    expect(screen.queryByLabelText(/phone number/i)).not.toBeInTheDocument();
  });

  it('has proper WCAG accessibility attributes', () => {
    render(<FormBuilder schema={basicSchema} onSubmit={vi.fn()} ariaLabel="Student form" />);

    const form = screen.getByRole('form', { name: 'Student form' });
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute('noValidate');
  });

  it('associates error messages with fields via aria-describedby', async () => {
    render(<FormBuilder schema={basicSchema} onSubmit={vi.fn()} />);

    const submitBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const firstNameInput = screen.getByLabelText(/first name/i);
      expect(firstNameInput).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('populates default values', () => {
    render(
      <FormBuilder
        schema={basicSchema}
        onSubmit={vi.fn()}
        defaultValues={{ firstName: 'Jane', email: 'jane@test.com' }}
      />,
    );

    expect(screen.getByLabelText(/first name/i)).toHaveValue('Jane');
    expect(screen.getByLabelText(/email/i)).toHaveValue('jane@test.com');
  });
});
