/**
 * @vitest-environment jsdom
 *
 * PRC-M061: the MFA challenge screen must accept a one-time backup code, not
 * only six-digit TOTP codes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const verifyMfa = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('returnTo=/'),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/auth', () => ({
  verifyMfa: (...args: unknown[]) => verifyMfa(...args),
  resendMfa: vi.fn(),
  sanitizeReturnTo: () => '/',
}));

import { MfaForm } from './mfa-form';

describe('MfaForm backup code (PRC-M061)', () => {
  beforeEach(() => {
    verifyMfa.mockReset();
    verifyMfa.mockResolvedValue({ success: false, message: 'used' });
  });

  it('switches to a labelled backup-code input and submits the normalised code', async () => {
    render(<MfaForm />);
    fireEvent.click(screen.getByRole('button', { name: 'useBackupCode' }));
    const input = screen.getByLabelText('backupCodeLabel');
    fireEvent.change(input, { target: { value: ' abcd-1234 ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'verify' }));
    });
    expect(verifyMfa).toHaveBeenCalledWith(null, 'ABCD-1234');
    // A rejected (e.g. already-used) code surfaces the server message.
    expect(screen.getByText('used')).toBeTruthy();
  });

  it('rejects a too-short backup code without calling the server', async () => {
    render(<MfaForm />);
    fireEvent.click(screen.getByRole('button', { name: 'useBackupCode' }));
    fireEvent.change(screen.getByLabelText('backupCodeLabel'), { target: { value: 'ab1' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'verify' }));
    });
    expect(verifyMfa).not.toHaveBeenCalled();
    expect(screen.getByText('backupCodeIncomplete')).toBeTruthy();
  });

  it('can switch back to the authenticator code input', () => {
    render(<MfaForm />);
    fireEvent.click(screen.getByRole('button', { name: 'useBackupCode' }));
    fireEvent.click(screen.getByRole('button', { name: 'useAuthenticatorCode' }));
    expect(screen.queryByLabelText('backupCodeLabel')).toBeNull();
  });
});
