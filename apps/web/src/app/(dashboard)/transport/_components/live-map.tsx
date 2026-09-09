'use client';

/**
 * Inline SVG equirectangular projection of lat/lng (G-920).
 * No MapLibre / Leaflet. Each marker has an OpenStreetMap deep link.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { refreshLiveMapAction } from '../actions';
import type { LiveStop, LiveVehicle } from '@/lib/transport/api';

const WIDTH = 800;
const HEIGHT = 420;
const PAD = 28;

function project(
  points: Array<{ latitude: number; longitude: number }>,
  lat: number,
  lng: number,
): { x: number; y: number } {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats) - 0.01;
  const maxLat = Math.max(...lats) + 0.01;
  const minLng = Math.min(...lngs) - 0.01;
  const maxLng = Math.max(...lngs) + 0.01;
  const x = PAD + ((lng - minLng) / (maxLng - minLng || 1)) * (WIDTH - PAD * 2);
  const y = PAD + ((maxLat - lat) / (maxLat - minLat || 1)) * (HEIGHT - PAD * 2);
  return { x, y };
}

export function LiveMapSvg({
  vehicles,
  stops,
}: {
  vehicles: LiveVehicle[];
  stops: LiveStop[];
}) {
  const points = [
    ...stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    ...vehicles.map((v) => ({ latitude: v.latitude, longitude: v.longitude })),
  ];
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        No mapped stops or GPS pings yet. Add stop coordinates and ingest a ping to plot the corridor.
      </p>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Live transport map of stops and buses"
      className="h-auto w-full max-w-full rounded-md border border-border bg-muted/30"
      data-testid="transport-live-map"
    >
      <title>Stops (circles) and buses (squares) on an equirectangular projection</title>
      {stops.map((stop) => {
        const { x, y } = project(points, stop.latitude, stop.longitude);
        return (
          <a key={stop.id} href={stop.osmUrl} target="_blank" rel="noreferrer">
            <circle cx={x} cy={y} r={8} fill="hsl(var(--primary))" />
            <text x={x + 12} y={y + 4} fontSize="12" fill="currentColor">
              {stop.name}
            </text>
          </a>
        );
      })}
      {vehicles.map((bus) => {
        const { x, y } = project(points, bus.latitude, bus.longitude);
        return (
          <a key={bus.vehicleId} href={bus.osmUrl} target="_blank" rel="noreferrer">
            <rect x={x - 7} y={y - 7} width={14} height={14} fill="hsl(var(--destructive))" />
            <text x={x + 12} y={y + 4} fontSize="12" fill="currentColor">
              {bus.registrationNumber ?? 'Bus'}
            </text>
          </a>
        );
      })}
    </svg>
  );
}

export function LiveMapRefresher() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      void refreshLiveMapAction();
      router.refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
