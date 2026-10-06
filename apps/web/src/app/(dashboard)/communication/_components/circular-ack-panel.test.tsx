/**
 * @vitest-environment jsdom
 *
 * PRC-M071: on-behalf acknowledgement uses a picker of pending recipients,
 * never a free-text recipient id. PR #548 owner decision: a reason is
 * required (labelled, validated, announced) and sent with the request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const ackCircularAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
vi.mock('../actions', () => ({
  ackCircularAction: (...args: unknown[]) => ackCircularAction(...args),
  sendCircularAction: vi.fn(),
}));

import { CircularAckPanel } from './circular-ack-panel';

describe('CircularAckPanel (PRC-M071)', () => {
  beforeEach(() => {
    ackCircularAction.mockReset().mockResolvedValue({ status: 'success', message: 'ok' });
  });

  function renderPanel() {
    render(
      <CircularAckPanel
        circularId="c-1"
        status="sent"
        ackRate={0}
        pendingRecipients={[
          { id: 'r-1', label: 'Asha Rao' },
          { id: 'r-2', label: 'Arjun Mehta' },
        ]}
      />,
    );
  }

  it('offers only pending recipients and submits the chosen id with a reason', async () => {
    renderPanel();
    const picker = screen.getByLabelText(
      /Record acknowledgement on behalf of/,
    ) as HTMLSelectElement;
    expect(picker.tagName).toBe('SELECT');
    fireEvent.change(picker, { target: { value: 'r-2' } });
    const reason = screen.getByRole('textbox', { name: /Reason/ });
    expect(reason).toHaveAttribute('aria-required', 'true');
    expect(reason).toHaveAttribute('maxLength', '500');
    fireEvent.change(reason, { target: { value: '  Signed paper slip returned ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record ack' }));
    });
    expect(ackCircularAction).toHaveBeenCalledWith('c-1', 'r-2', 'Signed paper slip returned');
  });

  it('blocks submit without a reason and announces an accessible error', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Record acknowledgement on behalf of/), {
      target: { value: 'r-1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record ack' }));
    });
    expect(ackCircularAction).not.toHaveBeenCalled();
    const reason = screen.getByRole('textbox', { name: /Reason/ });
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/why you are recording/i);
    expect(reason.getAttribute('aria-describedby')).toContain(alert.id);
    expect(document.activeElement).toBe(reason);
  });

  it('blocks submit without a recipient', async () => {
    renderPanel();
    fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), {
      target: { value: 'Paper slip' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record ack' }));
    });
    expect(ackCircularAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/select the recipient/i);
  });

  it('hides the on-behalf form when nobody is pending', () => {
    render(<CircularAckPanel circularId="c-1" status="sent" ackRate={1} />);
    expect(screen.queryByRole('button', { name: 'Record ack' })).toBeNull();
  });
});
