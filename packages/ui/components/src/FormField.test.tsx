import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';

import { Form, FormControl, FormItem, FormLabel, FormField as RHFFormField } from './Form';
import { FormField } from './FormField';

/** PRC-L198 — FormField ARIA merging and useFormField misuse guard. */
describe('<FormField /> ARIA wiring (PRC-L198)', () => {
  it("preserves the child's own aria-describedby and adds hint/error ids", () => {
    const { rerender } = render(
      <FormField id="email" label="Email" hint="We never share it">
        <input aria-describedby="external-help" />
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-describedby')).toBe('external-help email-description');
    expect(screen.getByText('We never share it')).toHaveAttribute('id', 'email-description');

    rerender(
      <FormField id="email" label="Email" hint="We never share it" error="Invalid email">
        <input aria-describedby="external-help" />
      </FormField>,
    );
    // Hidden description is no longer referenced while the error is shown.
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe(
      'external-help email-error',
    );
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it("generates an id when none is provided and keeps the child's id", () => {
    const { unmount } = render(
      <FormField label="Name" hint="Full name">
        <input />
      </FormField>,
    );
    const generated = screen.getByLabelText('Name');
    expect(generated.id).not.toBe('');
    expect(generated.getAttribute('aria-describedby')).toBe(`${generated.id}-description`);
    unmount();

    render(
      <FormField label="Phone">
        <input id="phone-input" />
      </FormField>,
    );
    expect(screen.getByLabelText('Phone')).toHaveAttribute('id', 'phone-input');
  });
});

describe('useFormField guard (PRC-L198)', () => {
  function Misused() {
    const form = useForm({ defaultValues: { name: '' } });
    return (
      <Form {...form}>
        <FormItem>
          <FormLabel>Name</FormLabel>
        </FormItem>
      </Form>
    );
  }

  function Correct() {
    const form = useForm({ defaultValues: { name: '' } });
    return (
      <Form {...form}>
        <RHFFormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
      </Form>
    );
  }

  it('throws when used outside <FormField>', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Misused />)).toThrow('useFormField should be used within <FormField>');
    spy.mockRestore();
  });

  it('wires label and control inside <FormField>', () => {
    render(<Correct />);
    expect(screen.getByLabelText('Name').tagName).toBe('INPUT');
  });
});
