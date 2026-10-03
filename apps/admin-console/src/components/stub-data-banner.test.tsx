/**
 * @vitest-environment jsdom
 *
 * PRC-H002: an unreachable gateway outside stub mode is announced, never
 * rendered as an empty-but-healthy platform.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StubDataBanner } from './stub-data-banner';

afterEach(cleanup);

describe('StubDataBanner (PRC-H002)', () => {
  it('renders nothing for live gateway data', () => {
    render(<StubDataBanner source="gateway" />);
    expect(screen.queryByTestId('stub-data-banner')).toBeNull();
  });

  it('announces an unreachable gateway as an alert', () => {
    render(<StubDataBanner source="unavailable" />);
    const banner = screen.getByRole('alert');
    expect(banner.getAttribute('data-mode')).toBe('unavailable');
    expect(banner.textContent).toMatch(/gateway unreachable/i);
  });

  it('keeps the demo banner for stub mode', () => {
    render(<StubDataBanner source="stub" />);
    expect(screen.getByTestId('stub-data-banner').getAttribute('data-mode')).toBe('stub');
  });
});
