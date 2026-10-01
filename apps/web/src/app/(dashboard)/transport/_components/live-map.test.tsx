/**
 * PRC-L057 — markers are focusable OSM links; refresher issues one request per tick.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { LiveMapRefresher, LiveMapSvg } from './live-map';

afterEach(() => {
  vi.useRealTimers();
  refresh.mockReset();
});

describe('LiveMapSvg (PRC-L057)', () => {
  it('renders each marker as a link to its osmUrl with an accessible name', () => {
    render(
      <LiveMapSvg
        stops={[
          {
            id: 's1',
            routeId: 'r1',
            name: 'Main Gate',
            latitude: 12.9,
            longitude: 77.6,
            stopOrder: 1,
            pickupTime: null,
            dropoffTime: null,
            osmUrl: 'https://www.openstreetmap.org/?mlat=12.9&mlon=77.6',
          },
        ]}
        vehicles={[
          {
            vehicleId: 'v1',
            registrationNumber: 'KA01AB1234',
            latitude: 12.91,
            longitude: 77.61,
            recordedAt: '2025-01-01T00:00:00Z',
            speedKph: null,
            headingDeg: null,
            osmUrl: 'https://www.openstreetmap.org/?mlat=12.91&mlon=77.61',
          },
        ]}
      />,
    );
    const bus = screen.getByTestId('transport-live-bus-marker');
    expect(bus.tagName.toLowerCase()).toBe('a');
    expect(bus).toHaveAttribute('href', 'https://www.openstreetmap.org/?mlat=12.91&mlon=77.61');
    expect(bus).toHaveAttribute('aria-label', 'Bus KA01AB1234 — open in OpenStreetMap');
    expect(screen.getByTestId('transport-live-stop-marker')).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/?mlat=12.9&mlon=77.6',
    );
    expect(screen.getByTestId('transport-live-map')).not.toHaveAttribute('role', 'img');
    expect(screen.getByText('Bus (1)')).toBeInTheDocument();
  });
});

describe('LiveMapRefresher (PRC-L057)', () => {
  it('calls router.refresh exactly once per 15s tick', () => {
    vi.useFakeTimers();
    render(<LiveMapRefresher />);
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
