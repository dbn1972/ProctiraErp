/** PRC-M085: the chain is verified only when the user asks for it. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ verifyAuditChainAction: vi.fn() }));
vi.mock('@/app/(dashboard)/audit-logs/actions', () => ({
  verifyAuditChainAction: m.verifyAuditChainAction,
}));

import { ChainIntegrityCard } from './chain-integrity-card';

describe('ChainIntegrityCard', () => {
  it('does not verify on render and verifies on click', async () => {
    m.verifyAuditChainAction.mockResolvedValue({
      forbidden: false,
      verification: {
        tenantId: 't',
        valid: true,
        checkedEntries: 3,
        legacyEntries: 0,
        headHash: 'abc',
        headSeq: 3,
        brokenAt: null,
        verifiedAt: '2026-01-01T00:00:00Z',
      },
    });
    render(<ChainIntegrityCard />);
    expect(m.verifyAuditChainAction).not.toHaveBeenCalled();
    expect(screen.getByText('Not checked')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chain-verify'));
    await waitFor(() =>
      expect(screen.getByTestId('chain-integrity').getAttribute('data-valid')).toBe('true'),
    );
    expect(m.verifyAuditChainAction).toHaveBeenCalledTimes(1);
  });
});
