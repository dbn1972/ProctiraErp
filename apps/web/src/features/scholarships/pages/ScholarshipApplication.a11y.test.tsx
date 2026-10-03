/**
 * PRC-M151: program-load failure is an alert with retry (not "No open programs"), and every
 * wizard input is programmatically labelled.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScholarshipApplication from './ScholarshipApplication';

const PROGRAM = '11111111-1111-4111-8111-111111111111';
let failPrograms = true;
let programCalls = 0;

vi.mock('../scholarship-browser', () => {
  class BrowserGatewayError extends Error {}
  return {
    BrowserGatewayError,
    scholarshipBrowserFetch: vi.fn(async (path: string) => {
      if (path.startsWith('/scholarships/programs')) {
        programCalls += 1;
        if (failPrograms) throw new BrowserGatewayError('Service unavailable (500)');
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
      return {};
    }),
  };
});
vi.mock('../components/document-upload-slots', () => ({
  DocumentUploadSlots: () => <div data-testid="upload-slots" />,
}));

beforeEach(() => {
  failPrograms = true;
  programCalls = 0;
});

describe('ScholarshipApplication program load (PRC-M151)', () => {
  it('shows an alert with retry when /programs fails, not the empty message', async () => {
    render(<ScholarshipApplication />);
    const alert = await screen.findByTestId('scholarship-programs-load-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('No open scholarship programs available.')).toBeNull();
    failPrograms = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Merit grant');
    expect(programCalls).toBe(2);
    expect(screen.getByRole('radiogroup', { name: 'Scholarship programs' })).toBeTruthy();
  });

  it('binds every academic and financial label to its input', async () => {
    failPrograms = false;
    render(
      <ScholarshipApplication
        applicantOptions={[{ id: 'stu-1', label: 'ADM-1 · Asha' }]}
        institutionOptions={[{ id: 'inst-1', label: 'North High' }]}
      />,
    );
    await screen.findByText('Merit grant');
    fireEvent.click(screen.getByText('Merit grant'));
    fireEvent.change(screen.getByLabelText('Applicant (student)', { selector: 'select' }), {
      target: { value: 'stu-1' },
    });
    fireEvent.change(screen.getByLabelText('Institution', { selector: 'select' }), {
      target: { value: 'inst-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Institution Name *')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText('Education Level *')).toBeTruthy();
    expect(screen.getByLabelText('GPA')).toBeTruthy();
    expect(screen.getByLabelText('Year Completed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText('Annual Family Income')).toBeTruthy();
    expect(screen.getByLabelText('Number of Dependents')).toBeTruthy();
    expect(screen.getByLabelText('Employment Status')).toBeTruthy();
  });
});
