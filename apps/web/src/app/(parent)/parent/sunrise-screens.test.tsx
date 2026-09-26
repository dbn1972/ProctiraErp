/**
 * Sunrise parent screens — confirm dialogs and the fees empty/plural states
 * observed against tenant 00000000-0000-4000-8000-00000000a501.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PayInvoiceButton } from './fees/_components/pay-invoice-button';
import { ConsentDecisionButtons } from './consents/_components/consent-decision-buttons';
import { AcceptOfferForm } from './offers/_components/accept-offer-form';
import { ChildSwitcher } from './_components/child-switcher';
import ParentFeesPage from './fees/page';
import {
  decideConsentAction,
  payInvoiceAction,
  acceptGuardianOfferAction,
} from '../parent-actions';

vi.mock('../parent-actions', () => ({
  payInvoiceAction: vi.fn(),
  decideConsentAction: vi.fn(),
  acceptGuardianOfferAction: vi.fn(),
  createThreadAction: vi.fn(),
  replyToThreadAction: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'parent-mehta' } })),
}));

vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentLabelsForIds: vi.fn(async (ids: string[]) => {
    const labels = new Map<string, string>();
    for (const id of ids) {
      if (id.endsWith('a5b1')) labels.set(id, 'SPS-NID-001 · Aarav Mehta');
      if (id.endsWith('a5b2')) labels.set(id, 'SPS-NID-002 · Diya Sharma');
    }
    return labels;
  }),
}));

const listInvoicesResult = vi.fn();
const listReceiptsResult = vi.fn();
vi.mock('@/lib/api/fees', () => ({
  listInvoicesResult: (...args: unknown[]) => listInvoicesResult(...args),
  listReceiptsResult: (...args: unknown[]) => listReceiptsResult(...args),
}));

const fetchList = vi.fn();
vi.mock('@/lib/api/list-result', () => ({
  fetchList: (...args: unknown[]) => fetchList(...args),
}));

const AARAV = '00000000-0000-4000-8000-00000000a5b1';
const STRUCTURE = '00000000-0000-4000-8000-00000000a5e4';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/parent/grades',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

describe('Sunrise parent confirm actions', () => {
  beforeEach(() => {
    vi.mocked(payInvoiceAction).mockReset();
    vi.mocked(decideConsentAction).mockReset();
    vi.mocked(acceptGuardianOfferAction).mockReset();
    vi.mocked(payInvoiceAction).mockResolvedValue({ status: 'success', message: 'ok' });
    vi.mocked(decideConsentAction).mockResolvedValue({ status: 'success', message: 'ok' });
    vi.mocked(acceptGuardianOfferAction).mockResolvedValue({ status: 'success', message: 'ok' });
  });

  it('opens pay confirm and only pays after the second step', async () => {
    render(<PayInvoiceButton invoiceId="00000000-0000-4000-8000-00000000a5f1" status="open" />);
    fireEvent.click(screen.getByTestId('parent-pay-button'));
    expect(screen.getByRole('dialog', { name: 'Pay this invoice?' })).toBeInTheDocument();
    expect(payInvoiceAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('parent-pay-confirm-confirm'));
    expect(payInvoiceAction).toHaveBeenCalledWith('00000000-0000-4000-8000-00000000a5f1');
  });

  it('hides pay on a paid invoice', () => {
    render(<PayInvoiceButton invoiceId="00000000-0000-4000-8000-00000000a5f2" status="paid" />);
    expect(screen.queryByTestId('parent-pay-button')).not.toBeInTheDocument();
  });

  it('confirms consent approve and deny without claiming deny stays pending', async () => {
    render(
      <ConsentDecisionButtons consentId="00000000-0000-4000-8000-00000000a621" status="pending" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    const deny = screen.getByRole('dialog', { name: 'Deny this consent?' });
    expect(deny).toHaveTextContent('Denying records your decision immediately.');
    expect(deny).not.toHaveTextContent('pending');
    fireEvent.click(screen.getByTestId('consent-deny-confirm-cancel'));
    expect(decideConsentAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByTestId('consent-approve-confirm-confirm'));
    expect(decideConsentAction).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-00000000a621',
      'approved',
    );
  });

  it('does not offer a decision on an approved consent', () => {
    render(
      <ConsentDecisionButtons consentId="00000000-0000-4000-8000-00000000a622" status="approved" />,
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('opens offer accept confirm for a sent offer', () => {
    render(
      <AcceptOfferForm
        offer={{
          id: 'offer-1',
          applicationId: 'app-1',
          status: 'sent',
          feeAmount: 5000,
          feeCurrency: 'INR',
          paymentRef: null,
          offerFeeInvoiceId: null,
          enrolledStudentId: null,
          expiresAt: null,
          applicantFirstName: 'Kabir',
          applicantLastName: 'Mehta',
          guardianEmail: 'parent-mehta@sunrise.test',
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('parent-accept-offer'));
    expect(screen.getByRole('dialog', { name: 'Accept this offer?' })).toBeInTheDocument();
    expect(acceptGuardianOfferAction).not.toHaveBeenCalled();
  });

  it('switches the selected child', () => {
    render(
      <ChildSwitcher
        selectedId={AARAV}
        studentLabels={{
          [AARAV]: 'Aarav Mehta',
          '00000000-0000-4000-8000-00000000a5b2': 'Diya Sharma',
        }}
        childrenLinks={[
          {
            id: '1',
            tenantId: '00000000-0000-4000-8000-00000000a501',
            parentUserId: 'parent-mehta',
            studentId: AARAV,
            relationship: 'father',
            status: 'active',
            createdAt: '',
            updatedAt: '',
          },
          {
            id: '2',
            tenantId: '00000000-0000-4000-8000-00000000a501',
            parentUserId: 'parent-mehta',
            studentId: '00000000-0000-4000-8000-00000000a5b2',
            relationship: 'father',
            status: 'active',
            createdAt: '',
            updatedAt: '',
          },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText('Select child'), {
      target: { value: '00000000-0000-4000-8000-00000000a5b2' },
    });
    expect(push).toHaveBeenCalledWith(
      '/parent/grades?studentId=00000000-0000-4000-8000-00000000a5b2',
    );
  });
});

describe('Sunrise fees page states', () => {
  beforeEach(() => {
    listInvoicesResult.mockReset();
    listReceiptsResult.mockReset();
    fetchList.mockReset();
    fetchList.mockResolvedValue({ ok: true, items: [] });
  });

  it('shows Aarav tuition, a pay action, and an empty instalment schedule', async () => {
    listInvoicesResult.mockResolvedValue({
      ok: true,
      items: [
        {
          id: '00000000-0000-4000-8000-00000000a5f1',
          studentId: AARAV,
          title: 'Term 1 tuition',
          description: 'Open tuition invoice for Aarav Mehta, class 9-B.',
          amountCents: 4_500_000,
          currency: 'INR',
          status: 'open',
          dueAt: '2026-10-14T18:30:00.000Z',
          structureId: STRUCTURE,
        },
      ],
    });
    listReceiptsResult.mockResolvedValue({ ok: true, items: [] });

    render(await ParentFeesPage());

    expect(screen.getByTestId('parent-remaining-balance')).toHaveTextContent('45,000');
    expect(screen.getByText('1 open invoice')).toBeInTheDocument();
    expect(screen.getByText('Term 1 tuition')).toBeInTheDocument();
    expect(screen.getByTestId('parent-pay-button')).toBeInTheDocument();
    expect(screen.getByTestId('parent-instalments-empty')).toHaveTextContent(
      'No instalment schedule yet',
    );
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    expect(fetchList).toHaveBeenCalledWith(
      `/fees/structures/${STRUCTURE}/instalments?scope=parent`,
      expect.anything(),
    );
  });

  it('pluralises zero open invoices without a stray space', async () => {
    listInvoicesResult.mockResolvedValue({
      ok: true,
      items: [
        {
          id: '00000000-0000-4000-8000-00000000a5f2',
          studentId: '00000000-0000-4000-8000-00000000a5b2',
          title: 'Term 1 transport',
          amountCents: 1_200_000,
          currency: 'INR',
          status: 'paid',
          structureId: '00000000-0000-4000-8000-00000000a5e5',
        },
      ],
    });
    listReceiptsResult.mockResolvedValue({
      ok: true,
      items: [
        {
          id: '00000000-0000-4000-8000-00000000a5f5',
          invoiceId: '00000000-0000-4000-8000-00000000a5f2',
          receiptNumber: 'SPS-RCT-2026-0001',
          amountCents: 1_200_000,
          currency: 'INR',
          issuedAt: '2026-07-10T05:45:00.000Z',
        },
      ],
    });

    render(await ParentFeesPage());

    expect(screen.getByText('0 open invoices')).toBeInTheDocument();
    expect(screen.queryByText(/invoice s/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('parent-pay-button')).not.toBeInTheDocument();
    expect(screen.getByText('SPS-RCT-2026-0001')).toBeInTheDocument();
  });
});
