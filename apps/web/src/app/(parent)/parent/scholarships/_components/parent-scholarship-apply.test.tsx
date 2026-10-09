/**
 * PRC-M131: the parent scholarship application must not submit fabricated academic
 * records or a zero/default family income. The guardian enters GPA, education level
 * and declared income; invalid or zero income blocks the draft, and only the
 * user-entered values are sent to the gateway.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserFetch = vi.fn();
vi.mock('@/features/scholarships/scholarship-browser', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/scholarships/scholarship-browser')
  >('@/features/scholarships/scholarship-browser');
  return { ...actual, scholarshipBrowserFetch: (...args: unknown[]) => browserFetch(...args) };
});

import { ParentScholarshipApply } from './parent-scholarship-apply';

const CHILDREN = [{ studentId: 'stu-1', label: 'Asha' }];

function mockLists() {
  // programs, then applications (both GET on mount)
  browserFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (!init?.method || init.method === 'GET') {
      if (path === '/programs') {
        return Promise.resolve({
          data: [{ id: 'prog-1', name: 'Merit', eligibility: { requiredDocuments: [] } }],
        });
      }
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ id: 'draft-1' });
  });
}

beforeEach(() => {
  browserFetch.mockReset();
  mockLists();
});

function fillField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('ParentScholarshipApply (PRC-M131)', () => {
  it('blocks the draft and does not POST when income is zero', async () => {
    render(<ParentScholarshipApply childrenLinks={CHILDREN} />);
    await screen.findByRole('button', { name: 'Start application' });
    fillField('Current school or institution', 'North High');
    fillField('GPA', '8.5');
    fillField('Declared annual family income', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Start application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/family income/i);
    const posts = browserFetch.mock.calls.filter(
      (c) => (c[1] as { method?: string } | undefined)?.method === 'POST',
    );
    expect(posts).toHaveLength(0);
  });

  it('sends only the guardian-entered academic record and income', async () => {
    render(<ParentScholarshipApply childrenLinks={CHILDREN} />);
    await screen.findByRole('button', { name: 'Start application' });
    fillField('Current school or institution', 'North High');
    fillField('Education level', 'senior_secondary');
    fillField('GPA', '8.5');
    fillField('Declared annual family income', '240000');
    fireEvent.click(screen.getByRole('button', { name: 'Start application' }));
    await waitFor(() => {
      const posts = browserFetch.mock.calls.filter(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'POST',
      );
      expect(posts).toHaveLength(1);
    });
    const post = browserFetch.mock.calls.find(
      (c) => (c[1] as { method?: string } | undefined)?.method === 'POST',
    );
    const json = (post![1] as { json: Record<string, unknown> }).json;
    expect(json.academicRecords).toEqual([
      { institutionName: 'North High', educationLevel: 'senior_secondary', gpa: 8.5 },
    ]);
    expect(json.financialInfo).toEqual({ familyIncome: 240000 });
  });
});
