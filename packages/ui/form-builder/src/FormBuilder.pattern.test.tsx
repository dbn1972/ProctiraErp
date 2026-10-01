import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormBuilder } from './FormBuilder';
import { compileSchemaPattern, validateSchemaPatterns } from './pattern-safety';
import type { FormSchema } from './types';

const schemaWith = (pattern: string): FormSchema => ({
  sections: [
    {
      title: 'S',
      fields: [
        {
          name: 'code',
          label: 'Code',
          type: 'text',
          validation: [{ type: 'pattern', value: pattern, message: 'Bad code' }],
        },
      ],
    },
  ],
});

describe('schema pattern safety (PRC-L515)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the form without throwing when a pattern is invalid', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<FormBuilder schema={schemaWith('([a-z')} onSubmit={vi.fn()} />),
    ).not.toThrow();
    expect(screen.getByLabelText('Code')).toBeInTheDocument();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Ignoring pattern rule'));
  });

  it('rejects catastrophic and over-long patterns at schema save', () => {
    expect(validateSchemaPatterns(schemaWith('^(a+)+$'))).toEqual([
      expect.objectContaining({ field: 'code', reason: expect.stringMatching(/nested/) }),
    ]);
    expect(validateSchemaPatterns(schemaWith('(.*)*x'))).toHaveLength(1);
    expect(validateSchemaPatterns(schemaWith('a'.repeat(300)))).toHaveLength(1);
    expect(validateSchemaPatterns(schemaWith('([a-z'))).toHaveLength(1);
    expect(validateSchemaPatterns(schemaWith('^[A-Z]{3}-\\d{4}$'))).toEqual([]);
  });

  it('compiles safe patterns', () => {
    const r = compileSchemaPattern('^\\d+$');
    expect(r.ok && r.regex.test('123')).toBe(true);
  });
});
