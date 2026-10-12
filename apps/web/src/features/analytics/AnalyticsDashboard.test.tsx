/**
 * @vitest-environment jsdom
 *
 * PRC-L533: the analytics dashboard renders a hard-coded fixture, so it must
 * carry a visible "Sample data" banner rather than imply the figures are live.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Recharts' ResponsiveContainer needs a size; stub it to render children.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 280 }}>{children}</div>
    ),
  };
});

import AnalyticsDashboard from './AnalyticsDashboard';

describe('AnalyticsDashboard sample-data honesty (PRC-L533)', () => {
  it('renders a visible Sample data banner', () => {
    render(<AnalyticsDashboard />);
    const banner = screen.getByTestId('analytics-sample-banner');
    expect(banner.textContent).toMatch(/sample data/i);
  });
});
