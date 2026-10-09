/**
 * @vitest-environment jsdom
 *
 * PRC-L258: the scaffold honesty banner fails closed. It is hidden only when
 * the caller proves a live gateway source; an unknown/undefined source warns.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { ScaffoldModeBanner } from './ScaffoldModeBanner';

describe('ScaffoldModeBanner fails closed (PRC-L258)', () => {
  it('shows the banner when the source is unknown/undefined', () => {
    const { queryByTestId } = render(<ScaffoldModeBanner surface="Reports" source={undefined} />);
    expect(queryByTestId('scaffold-mode-banner')).not.toBeNull();
  });

  it('shows the banner for a scaffold source', () => {
    const { queryByTestId } = render(<ScaffoldModeBanner surface="Reports" source="scaffold" />);
    expect(queryByTestId('scaffold-mode-banner')).not.toBeNull();
  });

  it('hides only when the source is explicitly the live gateway', () => {
    const { queryByTestId } = render(<ScaffoldModeBanner surface="Reports" source="gateway" />);
    expect(queryByTestId('scaffold-mode-banner')).toBeNull();
  });

  it('force overrides a gateway source', () => {
    const { queryByTestId } = render(
      <ScaffoldModeBanner surface="Reports" source="gateway" force />,
    );
    expect(queryByTestId('scaffold-mode-banner')).not.toBeNull();
  });
});
