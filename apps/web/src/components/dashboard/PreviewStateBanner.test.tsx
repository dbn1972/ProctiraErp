/**
 * @vitest-environment jsdom
 *
 * PreviewStateBanner tests (Task 10.3, `principal-dashboard-parity`,
 * Requirements 6.1, 6.10).
 *
 * `PreviewStateBanner` is a plain Server Component (no hooks, no
 * `'use client'`) that renders `null` when `activeState` is `null` and
 * otherwise renders a `variant="warning"` `Alert` naming the active state
 * via `PREVIEW_STATE_LABELS` (`@/lib/dashboard/previewStateLabels`) — the
 * same labels `PreviewStateSwitcher` uses, so the two surfaces never
 * disagree on wording. This mirrors the `ScaffoldModeBanner` precedent
 * (`apps/web/src/components/insights/ScaffoldModeBanner.tsx`): hidden when
 * its visibility condition isn't met, `role="status"` on the rendered
 * `Alert` otherwise.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PreviewStateBanner } from './PreviewStateBanner';
import { PREVIEW_STATES } from '@/lib/dashboard/previewStateCookie';
import { PREVIEW_STATE_LABELS } from '@/lib/dashboard/previewStateLabels';

describe('<PreviewStateBanner> — hidden when no preview state is active (Req 6.10)', () => {
  it('renders nothing when activeState is null', () => {
    const { container } = render(<PreviewStateBanner activeState={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not render the banner test id when activeState is null', () => {
    render(<PreviewStateBanner activeState={null} />);
    expect(screen.queryByTestId('preview-state-banner')).toBeNull();
  });
});

describe('<PreviewStateBanner> — visible fabricated-state indicator (Req 6.10)', () => {
  it.each(PREVIEW_STATES)('renders "Preview mode: %s" label for the "%s" state', (state) => {
    render(<PreviewStateBanner activeState={state} />);

    const banner = screen.getByTestId('preview-state-banner');
    expect(banner).toBeInTheDocument();

    const title = banner.querySelector('h5');
    expect(title?.textContent).toBe(`Preview mode: ${PREVIEW_STATE_LABELS[state]}`);
  });

  it('renders the exact "Degraded (services down)" label for the "degraded" state', () => {
    render(<PreviewStateBanner activeState="degraded" />);

    expect(screen.getByTestId('preview-state-banner').querySelector('h5')?.textContent).toBe(
      'Preview mode: Degraded (services down)',
    );
  });

  it('renders a distinct title per state, never the same text twice', () => {
    const titles = PREVIEW_STATES.map((state) => {
      const { unmount } = render(<PreviewStateBanner activeState={state} />);
      const text = screen.getByTestId('preview-state-banner').querySelector('h5')?.textContent;
      unmount();
      return text;
    });

    expect(new Set(titles).size).toBe(PREVIEW_STATES.length);
  });

  it('exposes role="status" on the banner (accessibility — ScaffoldModeBanner precedent)', () => {
    render(<PreviewStateBanner activeState="filled" />);
    expect(screen.getByTestId('preview-state-banner')).toHaveAttribute('role', 'status');
  });

  it('uses the warning Alert variant styling used by the ScaffoldModeBanner precedent', () => {
    render(<PreviewStateBanner activeState="filled" />);
    // The `warning` variant class list includes this distinguishing token
    // (see packages/ui/components/src/Alert.tsx's `alertVariants`).
    expect(screen.getByTestId('preview-state-banner').className).toContain('border-amber-300');
  });
});
