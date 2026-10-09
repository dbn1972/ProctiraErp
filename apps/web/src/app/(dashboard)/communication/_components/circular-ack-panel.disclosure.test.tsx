/**
 * @vitest-environment jsdom
 *
 * PRC-M073: the circular send dialog must not claim recipients will receive the
 * circular when delivery is sandbox-only. It discloses sandbox dispatch / no
 * live provider, matching the campaign and emergency flows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../actions', () => ({ ackCircularAction: vi.fn(), sendCircularAction: vi.fn() }));

import { CircularAckPanel } from './circular-ack-panel';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('CircularAckPanel send disclosure (PRC-M073)', () => {
  it('labels the action as a sandbox send', () => {
    render(<CircularAckPanel circularId="c-1" status="draft" ackRate={0} />);
    expect(screen.getByRole('button', { name: 'Sandbox send' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send circular' })).toBeNull();
  });

  it('discloses no live delivery in the confirmation dialog', () => {
    render(<CircularAckPanel circularId="c-1" status="draft" ackRate={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sandbox send' }));
    const dialog = screen.getByTestId('send-circular-confirm');
    expect(dialog.textContent).toMatch(/sandbox/i);
    expect(dialog.textContent).toMatch(/no live provider|not messaged/i);
    expect(dialog.textContent).not.toMatch(/Recipients will receive the circular/i);
  });
});
