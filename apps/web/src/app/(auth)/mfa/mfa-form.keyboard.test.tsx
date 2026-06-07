/**
 * @vitest-environment jsdom
 *
 * MfaForm code-input keyboard-contract tests — Task 56.6 / Req 37 AC 6.
 *
 * Validates the documented keyboard contract for the six-digit
 * multi-factor authentication code-entry surface
 * (`apps/web/src/app/(auth)/mfa/mfa-form.tsx`):
 *
 *   • The first digit input is auto-focused on mount.
 *   • Typing a digit auto-advances focus to the next slot.
 *   • Backspace on an empty slot moves focus to the previous slot.
 *   • Pasting a 6-digit string fills all slots and parks focus on the
 *     last slot.
 *   • Pasting a string that contains non-digit characters strips them
 *     and pastes the remaining digits.
 *
 * Mocks `next-intl`, `next/link`, `next/navigation`, and the
 * `verifyMfa` helper so the form can render in isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string | number>) => {
    if (key === 'digitNumber' && vars && typeof vars.number === 'number') {
      return `Digit ${vars.number}`;
    }
    const labels: Record<string, string> = {
      twoFactorAuthentication: 'Two-factor authentication',
      mfaSubtitle: 'Enter the 6-digit code',
      verificationCode: 'Verification code',
      verify: 'Verify',
      verifying: 'Verifying…',
      didntReceiveCode: "Didn't get a code?",
      resend: 'Resend',
      backToSignIn: 'Back to sign in',
      mfaTokenMissing: 'Token missing',
      mfaIncomplete: 'Code incomplete',
      mfaInvalid: 'Invalid code',
    };
    return labels[key] ?? key;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === 'token') return 'test-token';
      if (key === 'returnTo') return '/';
      return null;
    },
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/auth', () => ({
  verifyMfa: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: Array<string | undefined | null | false>) =>
    args.filter(Boolean).join(' '),
}));

// Stub the shared UI primitives that MfaForm imports so we don't
// drag in their internals (and their CSS modules / Tailwind classes).
vi.mock('@proctira/ui/components', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    type = 'button',
    disabled,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} disabled={disabled} {...props}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ─── Subject ─────────────────────────────────────────────────────────────────

import { MfaForm } from './mfa-form';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDigitInputs(): HTMLInputElement[] {
  return Array.from({ length: 6 }, (_, i) =>
    screen.getByLabelText(`Digit ${i + 1}`) as HTMLInputElement,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('<MfaForm> code-input keyboard contract — Task 56.6 / Req 37 AC 6', () => {
  it('renders six digit slots inside an aria-labelled group', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();
    expect(inputs.length).toBe(6);

    const group = screen.getByRole('group', { name: 'Verification code' });
    for (const input of inputs) {
      expect(group.contains(input)).toBe(true);
    }
  });

  it('auto-focuses the first digit slot on mount', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('typing a digit auto-advances focus to the next slot', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();

    act(() => {
      fireEvent.change(inputs[0], { target: { value: '1' } });
    });
    expect(inputs[0].value).toBe('1');
    expect(document.activeElement).toBe(inputs[1]);

    act(() => {
      fireEvent.change(inputs[1], { target: { value: '2' } });
    });
    expect(inputs[1].value).toBe('2');
    expect(document.activeElement).toBe(inputs[2]);
  });

  it('non-digit characters are ignored (only the last typed digit is kept)', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();

    act(() => {
      fireEvent.change(inputs[0], { target: { value: 'a' } });
    });
    // The handler strips non-digits and slices to one char, so the
    // slot remains empty and focus does not advance.
    expect(inputs[0].value).toBe('');
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('after typing into the last slot, focus stays on the last slot (no slot 7 to advance to)', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();

    // Fill slots 1-5 first.
    for (let i = 0; i < 5; i++) {
      act(() => {
        fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
      });
    }
    expect(document.activeElement).toBe(inputs[5]);

    act(() => {
      fireEvent.change(inputs[5], { target: { value: '6' } });
    });
    expect(inputs[5].value).toBe('6');
    expect(document.activeElement).toBe(inputs[5]);
  });

  it('Backspace on an empty slot moves focus to the previous slot', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();

    // Type into slot 0, then slot 1 — focus is now on slot 2 because
    // each digit auto-advances. Move focus back to the empty slot 2
    // and press Backspace.
    act(() => {
      fireEvent.change(inputs[0], { target: { value: '1' } });
    });
    expect(document.activeElement).toBe(inputs[1]);

    // Slot 1 is empty; press Backspace — focus should move back to
    // slot 0.
    act(() => {
      fireEvent.keyDown(inputs[1], { key: 'Backspace', code: 'Backspace' });
    });
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('Backspace on a slot containing a digit does NOT jump back (browser default clears the digit instead)', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();

    act(() => {
      fireEvent.change(inputs[0], { target: { value: '5' } });
    });
    // Auto-advance lands on slot 1; tab back to slot 0.
    act(() => inputs[0].focus());

    act(() => {
      fireEvent.keyDown(inputs[0], { key: 'Backspace', code: 'Backspace' });
    });
    // The handler does NOT move focus when the current slot has a
    // digit — the browser default clears the digit on the next
    // keypress. We assert focus remained on slot 0.
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('Pasting a 6-digit string fills every slot and parks focus on the last slot', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();

    act(() => {
      fireEvent.paste(inputs[0], {
        clipboardData: {
          getData: (type: string) => (type === 'text' ? '123456' : ''),
        },
      });
    });

    expect(inputs[0].value).toBe('1');
    expect(inputs[1].value).toBe('2');
    expect(inputs[2].value).toBe('3');
    expect(inputs[3].value).toBe('4');
    expect(inputs[4].value).toBe('5');
    expect(inputs[5].value).toBe('6');
    expect(document.activeElement).toBe(inputs[5]);
  });

  it('Pasting a string with non-digit characters strips them and fills the remaining digits in order', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();

    act(() => {
      fireEvent.paste(inputs[0], {
        clipboardData: {
          getData: (type: string) => (type === 'text' ? '12-34-56' : ''),
        },
      });
    });

    expect(inputs[0].value).toBe('1');
    expect(inputs[1].value).toBe('2');
    expect(inputs[2].value).toBe('3');
    expect(inputs[3].value).toBe('4');
    expect(inputs[4].value).toBe('5');
    expect(inputs[5].value).toBe('6');
  });

  it('Pasting fewer than 6 digits fills only the leading slots', () => {
    render(<MfaForm />);
    const inputs = getDigitInputs();

    act(() => {
      fireEvent.paste(inputs[0], {
        clipboardData: {
          getData: (type: string) => (type === 'text' ? '12' : ''),
        },
      });
    });

    expect(inputs[0].value).toBe('1');
    expect(inputs[1].value).toBe('2');
    expect(inputs[2].value).toBe('');
    expect(inputs[3].value).toBe('');
    // Focus parks on slot 2 (after the last filled position, capped
    // at 5).
    expect(document.activeElement).toBe(inputs[2]);
  });
});
