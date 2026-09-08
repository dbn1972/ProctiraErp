import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { DashboardSection } from './DashboardSection';

describe('<DashboardSection />', () => {
  it('renders the title, description, action slot, and body content', () => {
    render(
      <DashboardSection
        title="Today's overview"
        description="Last 24 hours"
        action={<button type="button">View all</button>}
        data-testid="section"
      >
        <div data-testid="body-child">Hello</div>
      </DashboardSection>,
    );

    expect(screen.getByRole('heading', { level: 2, name: "Today's overview" })).toBeInTheDocument();
    expect(screen.getByText('Last 24 hours')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View all' })).toBeInTheDocument();
    expect(screen.getByTestId('body-child')).toBeInTheDocument();

    const section = screen.getByTestId('section');
    expect(section).toHaveAttribute('data-state', 'ready');
  });

  it('renders skeleton placeholders when loading is true (and hides children)', () => {
    render(
      <DashboardSection
        title="Today's overview"
        loading
        loadingPlaceholders={3}
        data-testid="section"
      >
        <div data-testid="body-child">Hello</div>
      </DashboardSection>,
    );

    expect(screen.getByTestId('section')).toHaveAttribute('data-state', 'loading');
    const skel = screen.getByTestId('dashboard-section-skeleton');
    expect(skel).toBeInTheDocument();
    expect(skel.children).toHaveLength(3);
    expect(screen.queryByTestId('body-child')).toBeNull();
  });

  it('hides the body when collapsible and the user toggles the heading button', () => {
    render(
      <DashboardSection title="Today's overview" collapsible defaultExpanded data-testid="section">
        <div data-testid="body-child">Hello</div>
      </DashboardSection>,
    );

    expect(screen.getByTestId('body-child')).toBeInTheDocument();
    const toggle = screen.getByTestId('dashboard-section-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('body-child')).toBeNull();
  });
});
