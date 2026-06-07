import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PasswordStrengthMeter } from './PasswordStrengthMeter';

/**
 * Validates Task 49.2 — the shared `<PasswordStrengthMeter>` renders the
 * four-tier rating contract from design.md §D and reflects per-rule
 * satisfaction so callers like `<SignUp>` get a single source of truth
 * for the visual treatment.
 */

describe('<PasswordStrengthMeter />', () => {
  it('returns null when grade is null', () => {
    const { container } = render(
      <PasswordStrengthMeter grade={null} ratingLabel="Weak" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the bar with the rating data attribute', () => {
    render(
      <PasswordStrengthMeter
        grade={{ rating: 'strong', satisfied: 5, percent: 100 }}
        ratingLabel="Strong"
      />,
    );
    const bar = screen.getByTestId('password-meter-bar');
    expect(bar.dataset['rating']).toBe('strong');
    expect(bar.style.width).toBe('100%');
  });

  it('clamps percent to the 0..100 range', () => {
    render(
      <PasswordStrengthMeter
        grade={{ rating: 'weak', satisfied: 0, percent: 250 }}
        ratingLabel="Weak"
      />,
    );
    expect(screen.getByTestId('password-meter-bar').style.width).toBe('100%');
  });

  it('renders the rule list with per-rule satisfied state', () => {
    render(
      <PasswordStrengthMeter
        grade={{ rating: 'fair', satisfied: 3, percent: 60 }}
        ratingLabel="Fair"
        rules={[
          { key: 'length', label: 'At least 8 characters', satisfied: true },
          { key: 'symbol', label: 'One symbol', satisfied: false },
        ]}
      />,
    );
    expect(screen.getByTestId('password-meter-rule-length').dataset['satisfied']).toBe('true');
    expect(screen.getByTestId('password-meter-rule-symbol').dataset['satisfied']).toBe('false');
  });

  it('exposes a polite live region so screen readers announce changes', () => {
    render(
      <PasswordStrengthMeter
        grade={{ rating: 'good', satisfied: 4, percent: 80 }}
        ratingLabel="Good"
      />,
    );
    const meter = screen.getByTestId('password-meter');
    expect(meter).toHaveAttribute('role', 'status');
    expect(meter).toHaveAttribute('aria-live', 'polite');
  });

  it('uses the rating-specific bar class so colour conveys severity', () => {
    const { rerender } = render(
      <PasswordStrengthMeter
        grade={{ rating: 'weak', satisfied: 1, percent: 20 }}
        ratingLabel="Weak"
      />,
    );
    expect(screen.getByTestId('password-meter-bar').className).toContain(
      'bg-destructive',
    );

    rerender(
      <PasswordStrengthMeter
        grade={{ rating: 'strong', satisfied: 5, percent: 100 }}
        ratingLabel="Strong"
      />,
    );
    expect(screen.getByTestId('password-meter-bar').className).toContain(
      'bg-emerald-500',
    );
  });
});
