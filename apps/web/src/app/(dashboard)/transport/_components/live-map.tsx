'use client';

/**
 * Inline SVG equirectangular projection of lat/lng (G-920).
 * No MapLibre / Leaflet. Each marker is a focusable OpenStreetMap link (PRC-L057).
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

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

export function LiveMapSvg({ vehicles, stops }: { vehicles: LiveVehicle[]; stops: LiveStop[] }) {
  const points = [
    ...stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
    ...vehicles.map((v) => ({ latitude: v.latitude, longitude: v.longitude })),
  ];
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        No mapped stops or GPS pings yet. Add stop coordinates and ingest a ping to plot the
        corridor.
      </p>
    );
  }

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label="Live transport map of stops and buses"
        className="h-auto w-full max-w-full rounded-md border border-border bg-muted/30"
        data-testid="transport-live-map"
      >
        <title>Stops (circles) and buses (squares) on an equirectangular projection</title>
        {stops.map((stop) => {
          const { x, y } = project(points, stop.latitude, stop.longitude);
          return (
            <a
              key={stop.id}
              href={stop.osmUrl}
              aria-label={`Stop ${stop.name} — open in OpenStreetMap`}
              data-testid="transport-live-stop-marker"
              className="focus:outline-none [&:focus-visible>circle]:stroke-foreground [&:focus-visible>circle]:stroke-[3]"
            >
              <title>{stop.name}</title>
              <circle cx={x} cy={y} r={10} fill="hsl(var(--primary))" />
              <text
                x={x + 12}
                y={y + 4}
                fontSize="17"
                fill="currentColor"
                className="max-sm:hidden"
              >
                {stop.name}
              </text>
            </a>
          );
        })}
        {vehicles.map((bus) => {
          const { x, y } = project(points, bus.latitude, bus.longitude);
          const label = bus.registrationNumber ?? 'Bus';
          return (
            <a
              key={bus.vehicleId}
              href={bus.osmUrl}
              aria-label={`Bus ${label} — open in OpenStreetMap`}
              data-testid="transport-live-bus-marker"
              className="focus:outline-none [&:focus-visible>rect]:stroke-foreground [&:focus-visible>rect]:stroke-[3]"
            >
              <title>{label}</title>
              <rect x={x - 9} y={y - 9} width={18} height={18} fill="hsl(var(--destructive))" />
              <text
                x={x + 12}
                y={y + 4}
                fontSize="17"
                fill="currentColor"
                className="max-sm:hidden"
              >
                {label}
              </text>
            </a>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-primary" />
          Stop ({stops.length})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 bg-destructive" />
          Bus ({vehicles.length})
        </span>
        <span className="sm:hidden">
          Bus registrations are listed below the map; select a marker for its name.
        </span>
      </figcaption>
    </figure>
  );
}

export function LiveMapRefresher() {
  const router = useRouter();
  useEffect(() => {
    // router.refresh() re-renders the dynamic server page: one request per tick.
    const id = setInterval(() => {
      router.refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
