/**
 * ScholarshipApplication wizard — draft creation contract.
 * PRC-H030: the draft POST never carries placeholder subject ids.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScholarshipApplication from './ScholarshipApplication';

const PROGRAM = '11111111-1111-4111-8111-111111111111';
const NIL = '00000000-0000-4000-8000-000000000000';

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
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  const [institution, level] = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="text"]'),
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
  it('creates the draft without placeholder applicant or institution ids', async () => {
    const { container } = render(<ScholarshipApplication />);
    await reachDocuments(container);
    const posts = calls.filter(
      (c) => c.path === '/scholarships/applications' && c.method === 'POST',
    );
    expect(posts).toHaveLength(1);
    const body = posts[0]!.json!;
    expect(JSON.stringify(body)).not.toContain(NIL);
    expect(body).not.toHaveProperty('applicantId');
    expect(body).not.toHaveProperty('institutionId');
    expect(body.programId).toBe(PROGRAM);
    await waitFor(() => expect(screen.getByTestId('upload-slots')).toBeTruthy());
  });
});
