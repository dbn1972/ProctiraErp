/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScaffoldModeBanner } from './ScaffoldModeBanner';

describe('ScaffoldModeBanner fails closed (PRC-L258)', () => {
  it('renders when source is undefined', () => {
    render(<ScaffoldModeBanner surface="Reports" source={undefined} />);
    expect(screen.getByTestId('scaffold-mode-banner')).toBeTruthy();
    expect(screen.getByRole('status').textContent).not.toMatch(/demo-only/);
  });

  it('renders for scaffold and when forced', () => {
    const { rerender } = render(<ScaffoldModeBanner surface="Reports" source="scaffold" />);
    expect(screen.queryByTestId('scaffold-mode-banner')).toBeTruthy();
    rerender(<ScaffoldModeBanner surface="Reports" force source="gateway" />);
    expect(screen.queryByTestId('scaffold-mode-banner')).toBeTruthy();
  });

  it('hides only when the gateway responded', () => {
    render(<ScaffoldModeBanner surface="Reports" source="gateway" />);
    expect(screen.queryByTestId('scaffold-mode-banner')).toBeNull();
  });
});
