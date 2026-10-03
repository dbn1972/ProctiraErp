/**
 * @vitest-environment jsdom
 *
 * PRC-M118 — a score above the criterion max is rejected client- and
 * server-side, and the weighted total updates as scores change.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAppraisal = vi.fn();
const getAppraisalTemplate = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/lib/api/staff', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/staff')>()),
  createAppraisal: (...a: unknown[]) => createAppraisal(...a),
  getAppraisalTemplate: (...a: unknown[]) => getAppraisalTemplate(...a),
}));

import { createAppraisalAction } from '../actions';
import { computeAppraisalTotal } from '@/lib/validation/staff-schema';
import { AppraisalForm } from './appraisal-form';

const TEMPLATE_ID = '00000000-0000-4000-8000-0000000000aa';
const STAFF_ID = '00000000-0000-4000-8000-0000000000bb';
const template = {
  id: TEMPLATE_ID,
  name: 'Annual',
  scoreMin: 0,
  scoreMax: 100,
  criteria: [
    { name: 'Teaching', weight: 60, maxScore: 10 },
    { name: 'Conduct', weight: 40, maxScore: 5 },
  ],
};

describe('appraisal score validation + live total (PRC-M118)', () => {
  beforeEach(() => {
    createAppraisal.mockReset();
    getAppraisalTemplate.mockReset();
  });

  it('total uses the backend formula and is null until every criterion is scored', () => {
    expect(computeAppraisalTotal(template, [{ criterionName: 'Teaching', score: 5 }])).toBeNull();
    expect(
      computeAppraisalTotal(template, [
        { criterionName: 'Teaching', score: 5 },
        { criterionName: 'Conduct', score: 5 },
      ]),
    ).toBe(70);
  });

  it('server action rejects a score above the criterion max', async () => {
    getAppraisalTemplate.mockResolvedValue(template);
    const result = await createAppraisalAction(STAFF_ID, {
      templateId: TEMPLATE_ID,
      appraisalDate: '2025-01-10',
      scores: [
        { criterionName: 'Teaching', score: 11, comment: '' },
        { criterionName: 'Conduct', score: 5, comment: '' },
      ],
      overallComment: '',
    });
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/between 0 and 10/);
    expect(createAppraisal).not.toHaveBeenCalled();
  });

  it('client rejects over-max, shows the live total as scores change', async () => {
    render(<AppraisalForm staffId={STAFF_ID} templates={[template]} />);
    const total = screen.getByTestId('appraisal-live-total');
    expect(total.textContent).toContain('score every criterion');
    const [teaching, conduct] = screen.getAllByLabelText(/Score/) as HTMLInputElement[];
    fireEvent.change(teaching!, { target: { value: '10' } });
    fireEvent.change(conduct!, { target: { value: '5' } });
    await waitFor(() => expect(total.textContent).toContain('100 / 100'));
    fireEvent.change(teaching!, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save appraisal' }));
    expect(await screen.findByText('Score must be between 0 and 10')).toBeTruthy();
    expect(createAppraisal).not.toHaveBeenCalled();
  });
});
