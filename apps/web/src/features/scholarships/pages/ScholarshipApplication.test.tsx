/**
 * ScholarshipApplication wizard — draft creation contract.
 * PRC-H030: the draft POST never carries placeholder subject ids; with PRC-L077 it
 * carries the real applicant and institution the user chose.
 * PRC-H031: later edits (incl. the Review-step statement) are synced before submit, and
 * a double-click on Next creates exactly one draft.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScholarshipApplication from './ScholarshipApplication';

const PROGRAM = '11111111-1111-4111-8111-111111111111';
const NIL = '00000000-0000-4000-8000-000000000000';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const INSTITUTION = '44444444-4444-4444-8444-444444444444';

/** PRC-L077: the wizard needs a real applicant and institution from the directories. */
function renderWizard() {
  return render(
    <ScholarshipApplication
      applicantOptions={[{ id: STUDENT, label: 'ADM-1 · Asha' }]}
      institutionOptions={[{ id: INSTITUTION, label: 'NHS · North High' }]}
    />,
  );
}

function chooseSubject() {
  fireEvent.change(screen.getByLabelText('Applicant (student)', { selector: 'select' }), {
    target: { value: STUDENT },
  });
  fireEvent.change(screen.getByLabelText('Institution', { selector: 'select' }), {
    target: { value: INSTITUTION },
  });
}

type Call = { path: string; method: string; json?: Record<string, unknown> };
const calls: Call[] = [];

vi.mock('../scholarship-browser', () => {
  class BrowserGatewayError extends Error {}
  return {
    BrowserGatewayError,
    scholarshipBrowserFetch: vi.fn(
      async (path: string, init: { method?: string; json?: Record<string, unknown> } = {}) => {
        calls.push({ path, method: init.method ?? 'GET', json: init.json });
        if (path.startsWith('/scholarships/programs')) {
          return {
            data: [
              {
                id: PROGRAM,
                name: 'Merit grant',
                description: null,
                applicationStartDate: '2020-01-01',
                applicationEndDate: '2099-12-31',
                totalSlots: 5,
                usedSlots: 0,
                amountPerRecipient: 1000,
                currency: 'INR',
                eligibility: { requiredDocuments: [] },
              },
            ],
          };
        }
        if (path === '/scholarships/applications' && init.method === 'POST') {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { id: 'draft-1' };
        }
        return {};
      },
    ),
  };
});

vi.mock('../components/document-upload-slots', () => ({
  DocumentUploadSlots: () => <div data-testid="upload-slots" />,
}));

async function reachDocuments(container: HTMLElement) {
  await screen.findByText('Merit grant');
  fireEvent.click(screen.getByText('Merit grant'));
  chooseSubject();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  const [institution, level] = Array.from(
    container.querySelectorAll<HTMLInputElement>('fieldset input[type="text"]'),
  );
  fireEvent.change(institution!, { target: { value: 'Sunrise School' } });
  fireEvent.change(level!, { target: { value: 'Grade 10' } });
  const gpa = container.querySelector<HTMLInputElement>('input[step="0.01"]')!;
  fireEvent.change(gpa, { target: { value: '3.2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByTestId('upload-slots');
}

beforeEach(() => {
  calls.length = 0;
});

describe('ScholarshipApplication draft (PRC-H030)', () => {
  it('creates the draft with the chosen real ids, never placeholders', async () => {
    const { container } = renderWizard();
    await reachDocuments(container);
    const posts = calls.filter(
      (c) => c.path === '/scholarships/applications' && c.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    const body = posts[0]!.json!;
    expect(JSON.stringify(body)).not.toContain(NIL);
    expect(body.applicantId).toBe(STUDENT);
    expect(body.institutionId).toBe(INSTITUTION);
    expect(body.programId).toBe(PROGRAM);
    await waitFor(() => expect(screen.getByTestId('upload-slots')).toBeTruthy());
  });
});

describe('ScholarshipApplication draft sync (PRC-H031)', () => {
  it('sends the Review-step personal statement to the draft before submitting', async () => {
    const { container } = renderWizard();
    await reachDocuments(container);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const textarea = await screen.findByPlaceholderText(/why should you receive/i);
    fireEvent.change(textarea, { target: { value: 'I want to study engineering.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Application' }));
    await screen.findByText('Application Submitted');
    const put = calls.findIndex(
      (c) => c.path === '/scholarships/applications/draft-1' && c.method === 'PUT',
    );
    const submit = calls.findIndex((c) => c.path === '/scholarships/applications/draft-1/submit');
    expect(put).toBeGreaterThanOrEqual(0);
    expect(put).toBeLessThan(submit);
    expect(calls[put]!.json!.personalStatement).toBe('I want to study engineering.');
  });

  it('syncs a GPA edited after the draft was created', async () => {
    const { container } = renderWizard();
    await reachDocuments(container);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    const gpa = container.querySelector<HTMLInputElement>('input[step="0.01"]')!;
    fireEvent.change(gpa, { target: { value: '3.9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    const records = put.json!.academicRecords as Array<{ gpa?: number }>;
    expect(records[0]!.gpa).toBe(3.9);
    expect(
      calls.filter((c) => c.path === '/scholarships/applications' && c.method === 'POST'),
    ).toHaveLength(1);
  });

  it('creates exactly one draft when Next is clicked twice quickly', async () => {
    const { container } = renderWizard();
    await screen.findByText('Merit grant');
    fireEvent.click(screen.getByText('Merit grant'));
    chooseSubject();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const [institution, level] = Array.from(
      container.querySelectorAll<HTMLInputElement>('fieldset input[type="text"]'),
    );
    fireEvent.change(institution!, { target: { value: 'Sunrise School' } });
    fireEvent.change(level!, { target: { value: 'Grade 10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const next = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(next);
    fireEvent.click(next);
    await screen.findByTestId('upload-slots');
    expect(
      calls.filter((c) => c.path === '/scholarships/applications' && c.method === 'POST'),
    ).toHaveLength(1);
  });
});
