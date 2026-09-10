import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { MapDrillDown, type MapRegion } from './MapDrillDown';

const regions: ReadonlyArray<MapRegion> = [
  { id: 'tn', name: 'Tamil Nadu', value: 58400 },
  { id: 'mh', name: 'Maharashtra', value: 102300 },
];

describe('<MapDrillDown />', () => {
  it('renders the region list with values when data is loaded', () => {
    render(
      <MapDrillDown
        title="Enrollment by state"
        description="Latest snapshot"
        regions={regions}
        data-testid="map"
      />,
    );

    const card = screen.getByTestId('map');
    expect(card).toHaveAttribute('data-state', 'ready');
    const region = screen.getByTestId('map-drill-down-region');
    expect(region).toHaveAttribute('role', 'region');
    expect(screen.getByText('Tamil Nadu')).toBeInTheDocument();
    expect(screen.getByText('Maharashtra')).toBeInTheDocument();
    expect(screen.getByText('58400')).toBeInTheDocument();
  });

  it('renders a skeleton placeholder when loading', () => {
    render(<MapDrillDown title="Enrollment by state" regions={[]} loading data-testid="map" />);

    expect(screen.getByTestId('map')).toHaveAttribute('data-state', 'loading');
    expect(screen.getByTestId('map-drill-down-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('map-drill-down-list')).toBeNull();
  });

  it('renders the empty state when regions is empty after a load', () => {
    render(<MapDrillDown title="Enrollment by state" regions={[]} emptyMessage="Nothing to map" />);

    expect(screen.getByTestId('map-drill-down-empty').textContent).toBe('Nothing to map');
  });

  it('shows an inline error with role="alert" when error is set', () => {
    render(
      <MapDrillDown
        title="Enrollment by state"
        regions={[]}
        error={new Error('boom')}
        data-testid="map"
      />,
    );

    const card = screen.getByTestId('map');
    expect(card).toHaveAttribute('data-state', 'error');
    const err = screen.getByTestId('map-drill-down-error');
    expect(err).toHaveAttribute('role', 'alert');
  });

  it('invokes onRegionClick when a region is selected', () => {
    const onRegionClick = vi.fn();
    render(
      <MapDrillDown title="Enrollment by state" regions={regions} onRegionClick={onRegionClick} />,
    );

    fireEvent.click(screen.getByTestId('map-drill-down-region-tn'));
    expect(onRegionClick).toHaveBeenCalledWith(regions[0]);
  });
});
