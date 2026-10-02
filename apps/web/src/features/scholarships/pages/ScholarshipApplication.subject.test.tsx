/**
 * Split from ScholarshipApplication.test.tsx in the merge train (#504 H030/H031 x
 * #527 L077): each file needs its own scholarship-browser mock.
 * PRC-L077: the application draft carries the chosen applicant and
 * institution — never a nil/placeholder UUID — and submit posts to the draft.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('../scholarship-browser', async () => {
  const actual =
    await vi.importActual<typeof import('../scholarship-browser')>('../scholarship-browser');
  return { ...actual, scholarshipBrowserFetch: (...args: unknown[]) => fetchMock(...args) };
});

import ScholarshipApplication from './ScholarshipApplication';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const INSTITUTION = '22222222-2222-4222-8222-222222222222';
const program = {
  id: 'prog-1',
  name: 'Merit',
  description: null,
  applicationStartDate: '2025-01-01',
  applicationEndDate: '2025-12-31',
  totalSlots: 5,
  usedSlots: 0,
  amountPerRecipient: 1000,
  currency: 'INR',
  eligibility: {},
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.startsWith('/scholarships/programs')) return Promise.resolve({ data: [program] });
    if (path === '/scholarships/applications' && init?.method === 'POST') {
      return Promise.resolve({ id: 'draft-1' });
    }
    return Promise.resolve({});
  });
});

function renderForm() {
  return render(
    <ScholarshipApplication
      applicantOptions={[{ id: STUDENT, label: 'ADM-1 · Asha' }]}
      institutionOptions={[{ id: INSTITUTION, label: 'NHS · North High' }]}
    />,
  );
}

describe('ScholarshipApplication', () => {
  it('keeps Next disabled until program, applicant and institution are chosen', async () => {
    renderForm();
    fireEvent.click(await screen.findByText('Merit'));
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Applicant (student)', { selector: 'select' }), {
      target: { value: STUDENT },
    });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Institution', { selector: 'select' }), {
      target: { value: INSTITUTION },
    });
    expect(next).toBeEnabled();
  });

  it('creates the draft with the chosen applicant and institution ids', async () => {
    const { container } = renderForm();
    fireEvent.click(await screen.findByText('Merit'));
    fireEvent.change(screen.getByLabelText('Applicant (student)', { selector: 'select' }), {
      target: { value: STUDENT },
    });
    fireEvent.change(screen.getByLabelText('Institution', { selector: 'select' }), {
      target: { value: INSTITUTION },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const [schoolName, level] = Array.from(
      container.querySelectorAll<HTMLInputElement>('fieldset input[type="text"]'),
    );
    fireEvent.change(schoolName!, { target: { value: 'North High' } });
    fireEvent.change(level!, { target: { value: 'Grade 10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/scholarships/applications',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const draftCall = fetchMock.mock.calls.find((c) => c[0] === '/scholarships/applications')!;
    const body = (draftCall[1] as { json: Record<string, unknown> }).json;
    expect(body).toMatchObject({
      programId: 'prog-1',
      applicantId: STUDENT,
      institutionId: INSTITUTION,
      asDraft: true,
    });
    expect(JSON.stringify(body)).not.toContain('00000000-0000-4000-8000-000000000000');
  });
});
