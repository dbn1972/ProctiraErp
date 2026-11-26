/**
 * PRC-M152: the staff application wizard takes GPA on the selected program's
 * tenant-configured scale (eligibility.gpaScaleMax, default 4.0) and the
 * education level from the controlled vocabulary, not free text.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ScholarshipApplication from './ScholarshipApplication';

const TEN_POINT = '11111111-1111-4111-8111-111111111111';
const LEGACY = '22222222-2222-4222-8222-222222222222';

function program(id: string, name: string, eligibility: Record<string, unknown>) {
  return {
    id,
    name,
    description: null,
    applicationStartDate: '2020-01-01',
    applicationEndDate: '2099-12-31',
    totalSlots: 5,
    usedSlots: 0,
    amountPerRecipient: 1000,
    currency: 'INR',
    eligibility: { requiredDocuments: [], ...eligibility },
  };
}

vi.mock('../scholarship-browser', () => {
  class BrowserGatewayError extends Error {}
  return {
    BrowserGatewayError,
    scholarshipBrowserFetch: vi.fn(async (path: string) => {
      if (path.startsWith('/scholarships/programs')) {
        return {
          data: [
            program(TEN_POINT, 'CBSE merit', { gpaScaleMax: 10 }),
            program(LEGACY, 'Legacy grant', {}),
          ],
        };
      }
      return {};
    }),
  };
});
vi.mock('../components/document-upload-slots', () => ({
  DocumentUploadSlots: () => <div data-testid="upload-slots" />,
}));

async function openAcademicStep(programName: string) {
  render(
    <ScholarshipApplication
      applicantOptions={[{ id: 'stu-1', label: 'ADM-1 · Asha' }]}
      institutionOptions={[{ id: 'inst-1', label: 'North High' }]}
    />,
  );
  await screen.findByText(programName);
  fireEvent.click(screen.getByText(programName));
  fireEvent.change(screen.getByLabelText('Applicant (student)', { selector: 'select' }), {
    target: { value: 'stu-1' },
  });
  fireEvent.change(screen.getByLabelText('Institution', { selector: 'select' }), {
    target: { value: 'inst-1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

describe('ScholarshipApplication GPA scale and education level (PRC-M152)', () => {
  it('uses the program GPA scale (10.0) for the GPA input', async () => {
    await openAcademicStep('CBSE merit');
    const gpa = screen.getByLabelText('GPA');
    expect(gpa).toHaveAttribute('max', '10');
    expect(screen.getByText('0–10.0 scale for this program.')).toBeTruthy();
  });

  it('keeps the 4.0 scale for a program without a configured scale', async () => {
    await openAcademicStep('Legacy grant');
    expect(screen.getByLabelText('GPA')).toHaveAttribute('max', '4');
  });

  it('offers the controlled education-level vocabulary as a select', async () => {
    await openAcademicStep('CBSE merit');
    const level = screen.getByLabelText('Education Level *');
    expect(level.tagName).toBe('SELECT');
    const values = Array.from((level as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toEqual([
      '',
      'primary',
      'middle',
      'secondary',
      'senior_secondary',
      'undergraduate',
    ]);
  });
});
