/**
 * Infrastructure tab — Server Component — v2.0 redesign.
 *
 * Cite: redesign/web/institutions-infrastructure.html
 *
 * Renders the real Land → Building → Floor → Room hierarchy with capacity and
 * colour-coded condition pills, plus a per-tab toolbar and a warning banner
 * summarising any nodes flagged for repair. Powered by the institution
 * service's `/infrastructure/hierarchy` endpoint (Requirement 5.6).
 *
 * Repair CTAs: POST /institutions/:id/repairs + repair history list.
 */
import { AlertTriangle, Building, Home, Layers, Map as MapIcon } from 'lucide-react';

import {
  Card,
  CardContent,
} from '@proctira/ui/components';
import { InfrastructureActions } from '@/components/institutions/infrastructure-actions';
import { cn } from '@/lib/utils';
import {
  ApiClientError,
  getInfrastructureHierarchy,
} from '@/lib/institutions/api';
import type { InfrastructureHierarchy } from '@/lib/institutions/types';

interface InfrastructurePageProps {
  params: { id: string };
}

/* ──────────────────────────────── condition helpers ── */

function normCondition(condition: string): 'good' | 'fair' | 'repair' | 'unknown' {
  const c = condition.toUpperCase();
  if (c.includes('GOOD') || c.includes('AVAILABLE') || c.includes('NEW')) return 'good';
  if (c.includes('REPAIR') || c.includes('POOR') || c.includes('DAMAGED') || c.includes('BAD')) return 'repair';
  if (c.includes('FAIR') || c.includes('AVERAGE')) return 'fair';
  return 'unknown';
}

const CONDITION_PILL: Record<string, string> = {
  good:    'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  fair:    'bg-amber-50   text-amber-700   dark:bg-amber-950/40   dark:text-amber-400',
  repair:  'bg-red-50     text-red-700     dark:bg-red-950/40     dark:text-red-400',
  unknown: 'bg-zinc-100   text-zinc-600    dark:bg-zinc-800       dark:text-zinc-400',
};

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function ConditionPill({ condition }: { condition: string }) {
  const kind = normCondition(condition);
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', CONDITION_PILL[kind])}>
      {titleCase(condition)}
    </span>
  );
}

/* ──────────────────────────────── row ── */

function InfraRow({
  icon,
  title,
  capacity,
  condition,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  capacity: number;
  condition: string;
  description: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-1 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {description && (
          <span className="truncate text-xs font-normal text-muted-foreground">— {description}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
          Capacity {capacity.toLocaleString()}
        </span>
        <ConditionPill condition={condition} />
      </div>
    </div>
  );
}

/* ──────────────────────────────── repair counter ── */

function countRepairs(hierarchy: InfrastructureHierarchy): number {
  let n = 0;
  for (const land of hierarchy.lands) {
    if (normCondition(land.condition) === 'repair') n++;
    for (const b of land.buildings) {
      if (normCondition(b.condition) === 'repair') n++;
      for (const f of b.floors) {
        if (normCondition(f.condition) === 'repair') n++;
        for (const r of f.rooms) {
          if (normCondition(r.condition) === 'repair') n++;
        }
      }
    }
  }
  return n;
}

/* ──────────────────────────────── page ── */

function collectFacilityOptions(
  hierarchy: InfrastructureHierarchy,
): Array<{ id: string; label: string }> {
  const options: Array<{ id: string; label: string }> = [];
  for (const land of hierarchy.lands) {
    options.push({ id: land.id, label: `Land · ${land.name}` });
    for (const b of land.buildings) {
      options.push({ id: b.id, label: `Building · ${b.name}` });
      for (const f of b.floors) {
        options.push({ id: f.id, label: `Floor · ${f.name}` });
        for (const r of f.rooms) {
          options.push({ id: r.id, label: `Room · ${r.name}` });
        }
      }
    }
  }
  return options;
}

export default async function InstitutionInfrastructurePage({ params }: InfrastructurePageProps) {
  const result = await loadHierarchy(params.id);
  const hierarchy = result.error ? null : (result.hierarchy as InfrastructureHierarchy);
  const repairs = hierarchy ? countRepairs(hierarchy) : 0;
  const facilityOptions = hierarchy ? collectFacilityOptions(hierarchy) : [];

  return (
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Facility register</h2>
          <p className="text-sm text-muted-foreground">
            Land, buildings, floors, and rooms with capacity and condition
          </p>
        </div>
      </div>

      <InfrastructureActions
        institutionId={params.id}
        facilityOptions={facilityOptions}
      />

      {/* ── Repair warning ── */}
      {repairs > 0 && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              {repairs} {repairs === 1 ? 'facility needs' : 'facilities need'} repair
            </p>
            <p className="text-amber-700 dark:text-amber-400">
              Review the flagged items below and log a repair request to escalate them.
            </p>
          </div>
        </div>
      )}

      {/* ── Hierarchy ── */}
      <Card>
        <CardContent className="space-y-4 p-5">
          {result.error ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{result.error}</p>
          ) : result.hierarchy.lands.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <MapIcon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="text-base font-semibold">No infrastructure recorded</p>
              <p className="text-sm text-muted-foreground">
                Add land, buildings, and rooms to build this institution&apos;s facility register.
              </p>
            </div>
          ) : (
            result.hierarchy.lands.map((land) => (
              <div
                key={land.id}
                className="rounded-lg border border-border bg-muted/20 p-4"
                data-testid="infrastructure-land"
              >
                <InfraRow
                  icon={<MapIcon className="h-4 w-4" aria-hidden="true" />}
                  title={land.name}
                  capacity={land.capacity}
                  condition={land.condition}
                  description={land.description}
                />

                {land.buildings.length > 0 && (
                  <div className="mt-3 space-y-3 border-s-2 border-border ps-4">
                    {land.buildings.map((building) => (
                      <div key={building.id} className="space-y-2">
                        <InfraRow
                          icon={<Building className="h-4 w-4" aria-hidden="true" />}
                          title={building.name}
                          capacity={building.capacity}
                          condition={building.condition}
                          description={building.description}
                        />
                        {building.floors.length > 0 && (
                          <div className="ms-2 space-y-2 border-s border-border ps-4">
                            {building.floors.map((floor) => (
                              <div key={floor.id} className="space-y-1">
                                <InfraRow
                                  icon={<Layers className="h-4 w-4" aria-hidden="true" />}
                                  title={floor.name}
                                  capacity={floor.capacity}
                                  condition={floor.condition}
                                  description={floor.description}
                                />
                                {floor.rooms.length > 0 && (
                                  <ul className="ms-2 space-y-1 border-s border-border ps-4">
                                    {floor.rooms.map((room) => (
                                      <li key={room.id}>
                                        <InfraRow
                                          icon={<Home className="h-4 w-4" aria-hidden="true" />}
                                          title={room.name}
                                          capacity={room.capacity}
                                          condition={room.condition}
                                          description={room.description}
                                        />
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function loadHierarchy(
  institutionId: string
): Promise<
  | { hierarchy: InfrastructureHierarchy; error: null }
  | { hierarchy: { lands: [] }; error: string }
> {
  try {
    const hierarchy = await getInfrastructureHierarchy(institutionId);
    return { hierarchy, error: null };
  } catch (error) {
    return {
      hierarchy: { lands: [] },
      error:
        error instanceof ApiClientError
          ? error.message
          : 'Infrastructure data is currently unavailable.',
    };
  }
}
