/**
 * Institution detail layout (Server Component) — v2.0 redesign.
 *
 * Wraps each detail tab (overview, classes, grades, infrastructure) with a
 * shared hero header (gradient icon, name, status pill, resolved meta line,
 * actions) and tab navigation. Lookup IDs are resolved to human-readable
 * names so no raw UUIDs are shown to users.
 */
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { School } from 'lucide-react';

import { InstitutionScopeRegistrar } from '@/lib/institutions/institution-scope';
import { cn } from '@/lib/utils';
import { InstitutionDetailLeaveChrome } from '@/components/institutions/institution-detail-leave-chrome';
import {
  InstitutionGatewayDown,
  InstitutionHeroActions,
  InstitutionSectionTabs,
} from '@/components/institutions/institution-detail-chrome';
import { ApiClientError } from '@/lib/institutions/api';
import { getCachedInstitution } from '@/lib/institutions/request-cache';
import { classifyInstitutionLoadError } from '@/lib/institutions/load-state';
import {
  gatewaySimulationAllowed,
  isGatewaySimulationRequested,
} from '@/lib/institutions/gateway-simulation';
import type { Institution } from '@/lib/institutions/types';
import { loadAreaOptions, loadTypeOptions, resolveLookupLabel } from '@/lib/institutions/lookups';

interface InstitutionLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

function readStr(cd: Record<string, unknown> | null | undefined, key: string): string {
  const v = cd?.[key];
  return typeof v === 'string' ? v : '';
}

async function gatewaySimulationRequested(): Promise<boolean> {
  // Never honoured in production builds (PRC-L243).
  if (!gatewaySimulationAllowed()) return false;
  const jar = await cookies();
  return isGatewaySimulationRequested(jar.get('e2e-gateway-down')?.value);
}

export default async function InstitutionLayout({ params, children }: InstitutionLayoutProps) {
  const { id } = await params;
  // Cookie-only path for 16f: prove the dedicated unavailable chrome without a
  // live gateway. Real statusCode-0 failures use the stub below so ungated
  // Integration Tests can still mount child tab headings / Add controls.
  if (await gatewaySimulationRequested()) {
    return <InstitutionGatewayDown institutionId={id} />;
  }
  const loaded = await loadInstitution(id);

  if (loaded.state === 'missing') {
    notFound();
  }
  const institution = loaded.institution;
  const gatewayDown = loaded.state === 'gateway-down';

  const [areas, types] = await Promise.all([loadAreaOptions(), loadTypeOptions()]);

  const cd = (institution as unknown as { customData?: Record<string, unknown> }).customData ?? {};
  const areaName = resolveLookupLabel(areas, institution.areaId);
  const typeName = resolveLookupLabel(types, institution.typeId);
  // Medium from the overview snapshot is rendered on the overview tab so this
  // layout does not wait on that second read. customData still fills the hero
  // when the profile stored it.
  const medium = readStr(cd, 'medium');
  // Never paint a green Active pill when the school could not be loaded.
  const isUnavailable = gatewayDown || institution.name === 'Institution unavailable';
  const isActive = !isUnavailable && institution.status === 'ACTIVE';

  // Build the meta line, dropping empty parts.
  const metaParts = [
    institution.code && (
      <span key="code" className="font-mono">
        {institution.code}
      </span>
    ),
    areaName && <span key="area">{areaName}</span>,
    typeName && <span key="type">{typeName}</span>,
    medium && <span key="medium">{medium} medium</span>,
  ].filter(Boolean);

  return (
    <section className="-mt-3 space-y-3">
      <InstitutionScopeRegistrar id={institution.id} areaLabel={areaName || null} />
      {/* ── Hero head ── */}
      <div className="flex flex-col gap-2">
        <InstitutionDetailLeaveChrome />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm"
            >
              <School className="h-7 w-7" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                  {institution.name}
                </h1>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                    isUnavailable
                      ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                      : isActive
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
                  )}
                >
                  {isUnavailable ? 'Unavailable' : isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              {metaParts.length > 0 && (
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
                  {metaParts.map((part, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {i > 0 && (
                        <span aria-hidden="true" className="select-none">
                          ·
                        </span>
                      )}
                      {part}
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>

          <InstitutionHeroActions
            id={institution.id}
            name={institution.name}
            inactive={!isActive}
          />
        </div>

        {/* ── Tabs (omitted while editing) ── */}
        <InstitutionSectionTabs institutionId={institution.id} />
      </div>

      {children}
    </section>
  );
}

/**
 * Placeholder used when the gateway is unreachable so child tabs (grades,
 * classes, gradebook, …) can still mount their ungated Add / heading chrome.
 * Real 404s still call notFound() via a missing return. The hero must not
 * show a green Active pill for this stub (see isUnavailable above).
 */
function unavailableInstitution(id: string): Institution {
  return {
    id,
    name: 'Institution unavailable',
    code: '',
    areaId: '',
    typeId: '',
    sectorId: '',
    ownershipId: '',
    status: 'INACTIVE',
    latitude: null,
    longitude: null,
    address: null,
    contactPhone: null,
    contactEmail: null,
    deactivationReason: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

async function loadInstitution(
  id: string,
): Promise<
  | { state: 'ok'; institution: Institution }
  | { state: 'gateway-down'; institution: Institution }
  | { state: 'missing' }
> {
  try {
    return { state: 'ok', institution: await getCachedInstitution(id) };
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    const failure = classifyInstitutionLoadError(error);
    if (failure === 'not-found') return { state: 'missing' };
    if (failure === 'gateway-down') {
      return { state: 'gateway-down', institution: unavailableInstitution(id) };
    }
    throw error;
  }
}
