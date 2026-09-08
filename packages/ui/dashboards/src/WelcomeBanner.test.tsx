import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WelcomeBanner, greetingForHour } from './WelcomeBanner';

describe('greetingForHour()', () => {
  it.each([
    [0, 'Good evening'],
    [4, 'Good evening'],
    [5, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [16, 'Good afternoon'],
    [17, 'Good evening'],
    [23, 'Good evening'],
  ])('returns %s for hour %s', (hour, expected) => {
    expect(greetingForHour(hour)).toBe(expected);
  });

  it('falls back to "Hello" for non-finite hours', () => {
    expect(greetingForHour(Number.NaN)).toBe('Hello');
  });
});

describe('<WelcomeBanner />', () => {
  it('renders the greeting + brand name + formatted date when loaded', () => {
    const now = new Date('2024-04-15T09:00:00Z');
    render(
      <WelcomeBanner
        userName="Aarav"
        brandName="ProctiraERP"
        now={now}
        attentionSummary={<span>3 approvals pending</span>}
        data-testid="banner"
      />,
    );

    const banner = screen.getByTestId('banner');
    expect(banner).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('welcome-banner-greeting').textContent).toMatch(/, Aarav$/);
    expect(screen.getByTestId('welcome-banner-subtitle').textContent).toBe(
      'Welcome back to ProctiraERP.',
    );
    expect(screen.getByTestId('welcome-banner-attention').textContent).toBe('3 approvals pending');
  });

  it('renders skeletons while loading', () => {
    render(<WelcomeBanner userName="Aarav" brandName="ProctiraERP" loading data-testid="banner" />);

    const banner = screen.getByTestId('banner');
    expect(banner).toHaveAttribute('data-state', 'loading');
    expect(banner).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('welcome-banner-greeting')).toBeNull();
  });

  it('does not render the subtitle when brandName is omitted (still safe to mount)', () => {
    render(<WelcomeBanner userName="Aarav" data-testid="banner" />);

    expect(screen.queryByTestId('welcome-banner-subtitle')).toBeNull();
    // Greeting still renders in the empty-state-style minimal banner.
    expect(screen.getByTestId('welcome-banner-greeting')).toBeInTheDocument();
  });
});
