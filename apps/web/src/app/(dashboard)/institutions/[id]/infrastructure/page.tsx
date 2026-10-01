/**
 * Infrastructure tab — Server Component — v2.0 redesign.
 *
 * Renders the real Land → Building → Floor → Room hierarchy with capacity and
 * colour-coded condition pills, plus a per-tab toolbar and a warning banner
 * summarising any nodes flagged for repair. Powered by the institution
 * service's `/infrastructure/hierarchy` endpoint (Requirement 5.6).
 */
import { AlertTriangle, Building, Home, Layers, Map as MapIcon } from 'lucide-react';

import { fetchList } from '@/lib/api/list-result';
import { FacilityEditor } from '@/components/institutions/facility-editor';
import { VerificationReportButton } from '@/components/institutions/verification-report-button';
import { LogRepairRequestForm } from '@/components/institutions/log-repair-request-form';

import { Card, CardContent } from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { ApiClientError, getInfrastructureHierarchy } from '@/lib/institutions/api';
import type { InfrastructureHierarchy } from '@/lib/institutions/types';

interface InfrastructurePageProps {
  params: Promise<{ id: string }>;
}

/* ──────────────────────────────── condition helpers ── */

function normCondition(condition: string): 'good' | 'fair' | 'repair' | 'unknown' {
  const c = condition.toUpperCase();
  if (c.includes('GOOD') || c.includes('AVAILABLE') || c.includes('NEW')) return 'good';
  if (c.includes('REPAIR') || c.includes('POOR') || c.includes('DAMAGED') || c.includes('BAD'))
    return 'repair';
  if (c.includes('FAIR') || c.includes('AVERAGE')) return 'fair';
  return 'unknown';
}

const CONDITION_PILL: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  fair: 'bg-amber-50   text-amber-700   dark:bg-amber-950/40   dark:text-amber-400',
  repair: 'bg-red-50     text-red-700     dark:bg-red-950/40     dark:text-red-400',
  unknown: 'bg-zinc-100   text-zinc-600    dark:bg-zinc-800       dark:text-zinc-400',
};

const CONDITION_LABELS = ['Good', 'Fair', 'Needs repair', 'Unknown'] as const;

function conditionLabel(condition: string): string {
  const known = CONDITION_LABELS.find((item) => item.toLowerCase() === condition.toLowerCase());
  if (known) return known;
  return condition
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function ConditionPill({ condition }: { condition: string }) {
  const kind = normCondition(condition);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        CONDITION_PILL[kind],
      )}
    >
      {conditionLabel(condition)}
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
  nodeId,
  childCapacity,
}: {
  icon: React.ReactNode;
  title: string;
  capacity: number;
  condition: string;
  description: string | null;
  nodeId: string;
  childCapacity?: number | null;
}) {
  const repair = normCondition(condition) === 'repair';
  const mismatch =
    childCapacity != null && childCapacity > capacity
      ? `Parts total ${childCapacity.toLocaleString()} exceeds declared ${capacity.toLocaleString()}`
      : null;
  return (
    <div
      id={`facility-${nodeId}`}
      data-testid={`facility-${title}`}
      className={
        repair
          ? 'flex scroll-mt-24 flex-col gap-1.5 rounded-md bg-red-50/70 py-1 sm:flex-row sm:items-center sm:justify-between dark:bg-red-950/20'
          : 'flex flex-col gap-1.5 py-1 sm:flex-row sm:items-center sm:justify-between'
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {description && (
          <span className="truncate text-xs font-normal text-muted-foreground">
            — {description}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
          Capacity {capacity.toLocaleString()}
        </span>
        <ConditionPill condition={condition} />
      </div>
      {mismatch ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">{mismatch}</p>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────── repair counter ── */

function repairTargets(hierarchy: InfrastructureHierarchy): Array<{ id: string; name: string }> {
  const items: Array<{ id: string; name: string }> = [];
  for (const land of hierarchy.lands) {
    if (normCondition(land.condition) === 'repair') items.push({ id: land.id, name: land.name });
    for (const building of land.buildings) {
      if (normCondition(building.condition) === 'repair')
        items.push({ id: building.id, name: building.name });
      for (const floor of building.floors) {
        if (normCondition(floor.condition) === 'repair')
          items.push({ id: floor.id, name: floor.name });
        for (const room of floor.rooms) {
          if (normCondition(room.condition) === 'repair')
            items.push({ id: room.id, name: room.name });
        }
      }
    }
  }
  return items;
}

function facilityNameMap(hierarchy: InfrastructureHierarchy): Map<string, string> {
  const names = new Map<string, string>();
  for (const land of hierarchy.lands) {
    names.set(land.id, land.name);
    for (const building of land.buildings) {
      names.set(building.id, building.name);
      for (const floor of building.floors) {
        names.set(floor.id, floor.name);
        for (const room of floor.rooms) names.set(room.id, room.name);
      }
    }
  }
  return names;
}

function formatRepairDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

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

export default async function InstitutionInfrastructurePage(props: InfrastructurePageProps) {
  const params = await props.params;
  const result = await loadHierarchy(params.id);
  const repairsList = await fetchList<{
    id: string;
    summary: string;
    infrastructureId: string;
    status: string;
    createdAt: string;
  }>(`/infrastructure/repair-requests?institutionId=${encodeURIComponent(params.id)}`, {
    method: 'GET',
    cache: 'no-store',
  });
  const facilityNames = result.error
    ? new Map<string, string>()
    : facilityNameMap(result.hierarchy as InfrastructureHierarchy);
  const repairs = result.error ? 0 : countRepairs(result.hierarchy as InfrastructureHierarchy);

  return (
    <div className="space-y-4" data-testid="institution-infrastructure">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Facility register</h2>
          <p className="text-sm text-muted-foreground">
            Land, buildings, floors, and rooms with capacity and condition
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <VerificationReportButton institutionId={params.id} />
        </div>
      </div>

      {/* ── Repair warning ── */}
      {repairs > 0 && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              {repairs} {repairs === 1 ? 'facility needs' : 'facilities need'} repair
            </p>
            <p className="text-amber-700 dark:text-amber-400">
              Review the flagged items below and log a repair request to escalate them.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {repairTargets(result.hierarchy as InfrastructureHierarchy).map((item) => (
                <a
                  key={item.id}
                  href={`#facility-${item.id}`}
                  className="text-sm font-semibold text-amber-900 underline dark:text-amber-200"
                >
                  {item.name}
                </a>
              ))}
            </div>
            {!result.error ? (
              <LogRepairRequestForm
                institutionId={params.id}
                targets={repairTargets(result.hierarchy as InfrastructureHierarchy)}
              />
            ) : null}
            {repairsList.ok && repairsList.items.length > 0 ? (
              <table
                className="mt-3 w-full border-collapse text-start text-sm"
                data-testid="repair-request-list"
              >
                <thead>
                  <tr className="text-amber-900 dark:text-amber-200">
                    <th className="py-1 pe-3 font-semibold">Facility</th>
                    <th className="py-1 pe-3 font-semibold">Request</th>
                    <th className="py-1 pe-3 font-semibold">Date</th>
                    <th className="py-1 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {repairsList.items.map((row) => (
                    <tr key={row.id} className="border-t border-amber-200/80 dark:border-amber-800">
                      <td className="py-1 pe-3">
                        {facilityNames.get(row.infrastructureId) ?? 'Unknown facility'}
                      </td>
                      <td className="py-1 pe-3">{row.summary}</td>
                      <td className="py-1 pe-3 tabular-nums">{formatRepairDate(row.createdAt)}</td>
                      <td className="py-1 capitalize">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {!repairsList.ok ? (
              <p className="mt-2 text-sm" role="alert" data-testid="repair-request-error">
                Repair requests could not be loaded.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {!result.error && result.hierarchy.lands.length > 0 ? (
        <FacilityEditor
          institutionId={params.id}
          floors={result.hierarchy.lands.flatMap((land) =>
            land.buildings.flatMap((building) =>
              building.floors.map((floor) => ({
                id: floor.id,
                name: `${building.name} · ${floor.name}`,
              })),
            ),
          )}
          nodes={result.hierarchy.lands.flatMap((land) => [
            { id: land.id, name: land.name, capacity: land.capacity, condition: land.condition },
            ...land.buildings.flatMap((building) => [
              {
                id: building.id,
                name: building.name,
                capacity: building.capacity,
                condition: building.condition,
              },
              ...building.floors.flatMap((floor) => [
                {
                  id: floor.id,
                  name: floor.name,
                  capacity: floor.capacity,
                  condition: floor.condition,
                },
                ...floor.rooms.map((room) => ({
                  id: room.id,
                  name: room.name,
                  capacity: room.capacity,
                  condition: room.condition,
                })),
              ]),
            ]),
          ])}
        />
      ) : null}

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
                  nodeId={land.id}
                  childCapacity={land.buildings.reduce(
                    (sum, building) => sum + building.capacity,
                    0,
                  )}
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
                          nodeId={building.id}
                          childCapacity={building.floors.reduce(
                            (sum, floor) => sum + floor.capacity,
                            0,
                          )}
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
                                  nodeId={floor.id}
                                  childCapacity={floor.rooms.reduce(
                                    (sum, room) => sum + room.capacity,
                                    0,
                                  )}
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
                                          nodeId={room.id}
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
  institutionId: string,
): Promise<
  { hierarchy: InfrastructureHierarchy; error: null } | { hierarchy: { lands: [] }; error: string }
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
