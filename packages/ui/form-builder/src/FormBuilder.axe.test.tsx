import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { FormBuilder } from './FormBuilder';
import type { FormSchema } from './types';

/**
 * PRC-L597 — widget-level axe-core WCAG 2.1 AA gate for `<FormBuilder>`.
 * Complements the existing `FormBuilder.a11y.test.tsx` (PRC-L518, which asserts
 * the ARIA group-error semantics explicitly) with a holistic axe pass over a
 * mixed-field schema so a future markup regression fails CI.
 *
 * Regression gate (not failing-first): asserts the current contract and
 * guards it going forward.
 */
const schema: FormSchema = {
  sections: [
    {
      title: 'Guardian details',
      fields: [
        {
          name: 'fullName',
          label: 'Full name',
          type: 'text',
          helpText: 'As printed on the identity document',
          validation: [{ type: 'required', message: 'Enter the full name' }],
        },
        {
          name: 'relationship',
          label: 'Relationship',
          type: 'select',
          options: [
            { label: 'Parent', value: 'parent' },
            { label: 'Guardian', value: 'guardian' },
          ],
        },
        {
          name: 'gender',
          label: 'Gender',
          type: 'radio',
          options: [
            { label: 'Female', value: 'f' },
            { label: 'Male', value: 'm' },
          ],
        },
        {
          name: 'consent',
          label: 'I consent to contact',
          type: 'checkbox',
        },
      ],
    },
  ],
};

describe('<FormBuilder /> — axe-core WCAG 2.1 AA gate (PRC-L597)', () => {
  it('mixed-field form in its initial state has no violations', async () => {
    const { container } = render(<FormBuilder schema={schema} onSubmit={vi.fn()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
