/**
 * PRC-M152: the guardian enters GPA on the program's tenant-configured scale
 * (eligibility.gpaScaleMax), not a hard-coded 4.0.
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

beforeEach(() => {
  browserFetch.mockReset();
  browserFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (!init?.method || init.method === 'GET') {
      if (path === '/programs') {
        return Promise.resolve({
          data: [
            {
              id: 'prog-10',
              name: 'CBSE merit',
              eligibility: { requiredDocuments: [], gpaScaleMax: 10 },
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ id: 'draft-1' });
  });
});

function fillField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function posts() {
  return browserFetch.mock.calls.filter(
    (c) => (c[1] as { method?: string } | undefined)?.method === 'POST',
  );
}

describe('ParentScholarshipApply GPA scale (PRC-M152)', () => {
  it('accepts 8.5 on a 10-point program and sends it', async () => {
    render(<ParentScholarshipApply childrenLinks={CHILDREN} />);
    await screen.findByRole('button', { name: 'Start application' });
    expect(screen.getByLabelText('GPA')).toHaveAttribute('max', '10');
    fillField('Current school or institution', 'North High');
    fillField('GPA', '8.5');
    fillField('Declared annual family income', '240000');
    fireEvent.click(screen.getByRole('button', { name: 'Start application' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const json = (posts()[0]![1] as { json: { academicRecords: Array<{ gpa: number }> } }).json;
    expect(json.academicRecords[0]!.gpa).toBe(8.5);
  });

  it('rejects a GPA above the program scale without POSTing', async () => {
    render(<ParentScholarshipApply childrenLinks={CHILDREN} />);
    await screen.findByRole('button', { name: 'Start application' });
    fillField('Current school or institution', 'North High');
    fillField('GPA', '10.5');
    fillField('Declared annual family income', '240000');
    fireEvent.click(screen.getByRole('button', { name: 'Start application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/between 0 and 10\.0/);
    expect(posts()).toHaveLength(0);
  });
});
