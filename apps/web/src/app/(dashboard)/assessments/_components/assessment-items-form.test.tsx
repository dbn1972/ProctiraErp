/**
 * @vitest-environment jsdom
 *
 * PRC-M069: changing subject/period reloads that pair's items via the URL,
 * and Save stays disabled until the on-screen pair matches the loaded pair
 * (saving replaces the pair's items server-side).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('subjectId=sub-1&academicPeriodId=per-1'),
}));
vi.mock('../actions', () => ({ defineAssessmentItemsAction: vi.fn() }));
vi.mock('@proctira/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/ui/components')>();
  return {
    ...actual,
    // Native stand-ins for the Radix Select so jsdom can drive value changes.
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (v: string) => void;
      children: React.ReactNode;
    }) => (
      <select value={value ?? ''} onChange={(e) => onValueChange?.(e.target.value)}>
        <option value="" />
        {children}
      </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

import { AssessmentItemsForm } from './assessment-items-form';

const props = {
  schemes: [{ id: 'sch-1', name: 'Default' }],
  subjects: [
    { id: 'sub-1', name: 'Maths' },
    { id: 'sub-2', name: 'Science' },
  ],
  academicPeriods: [{ id: 'per-1', name: 'Term 1' }],
  defaultSubjectId: 'sub-1',
  defaultAcademicPeriodId: 'per-1',
  defaultSchemeId: 'sch-1',
} as unknown as React.ComponentProps<typeof AssessmentItemsForm>;

describe('AssessmentItemsForm pair reload (PRC-M069)', () => {
  beforeEach(() => replace.mockReset());

  it('enables Save when the selected pair is the loaded pair', () => {
    render(<AssessmentItemsForm {...props} />);
    expect((screen.getByRole('button', { name: 'Save items' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('reloads via the URL and disables Save after switching subject', () => {
    render(<AssessmentItemsForm {...props} />);
    const subjectSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(subjectSelect, { target: { value: 'sub-2' } });
    expect(replace).toHaveBeenCalledWith(
      '/assessments/items?subjectId=sub-2&academicPeriodId=per-1',
    );
    expect((screen.getByRole('button', { name: 'Save items' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByTestId('items-pair-reloading')).toBeTruthy();
  });

  it('keeps Save disabled when no pair has been loaded', () => {
    render(<AssessmentItemsForm {...props} defaultSubjectId="" defaultAcademicPeriodId="" />);
    expect((screen.getByRole('button', { name: 'Save items' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
