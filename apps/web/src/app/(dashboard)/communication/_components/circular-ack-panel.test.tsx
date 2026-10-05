/**
 * @vitest-environment jsdom
 *
 * PRC-M071: on-behalf acknowledgement uses a picker of pending recipients,
 * never a free-text recipient id.
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

  it('offers only pending recipients and submits the chosen id', async () => {
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
    expect(screen.queryByRole('textbox')).toBeNull();
    const picker = screen.getByLabelText(
      'Record acknowledgement on behalf of',
    ) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'r-2' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record ack' }));
    });
    expect(ackCircularAction).toHaveBeenCalledWith('c-1', 'r-2');
  });

  it('hides the on-behalf form when nobody is pending', () => {
    render(<CircularAckPanel circularId="c-1" status="sent" ackRate={1} />);
    expect(screen.queryByRole('button', { name: 'Record ack' })).toBeNull();
  });
});
