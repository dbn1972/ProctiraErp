/**
 * Institution detail layout (Server Component) — v2.0 redesign.
 *
 * Wraps each detail tab (overview, classes, grades, infrastructure) with a
 * shared hero header (gradient icon, name, status pill, resolved meta line,
 * actions) and tab navigation. Lookup IDs are resolved to human-readable
 * names so no raw UUIDs are shown to users.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, Pencil, School } from 'lucide-react';

import { Button } from '@proctira/ui/components';
import { cn } from '@/lib/utils';
import { InstitutionTabs } from '@/components/institutions/institution-tabs';
import { ApiClientError, getInstitution } from '@/lib/institutions/api';
import type { Institution } from '@/lib/institutions/types';
import {
  loadAreaOptions,
  loadOwnershipOptions,
  loadSectorOptions,
  loadTypeOptions,
} from '@/lib/institutions/lookups';

interface InstitutionLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

function nameFor(options: { id: string; name: string }[], id: string): string {
  return (
    options
      .find((o) => o.id === id)
      ?.name.replace(/^(—\s)+/, '')
      .trim() ?? ''
  );
}

function readStr(cd: Record<string, unknown> | null | undefined, key: string): string {
  const v = cd?.[key];
  return typeof v === 'string' ? v : '';
}

export default async function InstitutionLayout({ params, children }: InstitutionLayoutProps) {
  const { id } = await params;
  const institution = await loadInstitution(id);

  if (!institution) {
    notFound();
  }

  const [areas, types, sectors, ownerships] = await Promise.all([
    loadAreaOptions(),
    loadTypeOptions(),
    loadSectorOptions(),
    loadOwnershipOptions(),
  ]);

  const cd = (institution as unknown as { customData?: Record<string, unknown> }).customData ?? {};
  const areaName = nameFor(areas, institution.areaId);
  const typeName = nameFor(types, institution.typeId);
  const medium = readStr(cd, 'medium');
  const isActive = institution.status === 'ACTIVE';

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
    <section className="space-y-6">
      {/* ── Hero head ── */}
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
          <Link href="/institutions">
            <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
            Back to institutions
          </Link>
        </Button>

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
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                      : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
                  )}
                >
                  {isActive ? 'Active' : 'Inactive'}
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

          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/institutions/${institution.id}/edit`}>
                <Pencil className="me-1.5 h-4 w-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/institutions/${institution.id}/overview`}>
                <FileText className="me-1.5 h-4 w-4" aria-hidden="true" />
                School report
              </Link>
            </Button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <InstitutionTabs institutionId={institution.id} />
      </div>

      {children}
    </section>
  );
}

/**
 * Placeholder used when the gateway is unreachable so child tabs (grades,
 * classes, gradebook, …) can still mount their ungated Add / heading chrome.
 * Real 404s still call notFound() via a null return.
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
    status: 'ACTIVE',
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

async function loadInstitution(id: string) {
  try {
    return await getInstitution(id);
  } catch (error) {
    if (error instanceof ApiClientError && error.statusCode === 404) {
      return null;
    }
    // statusCode 0 = network / gateway down (Integration Tests ungated path).
    if (error instanceof ApiClientError && error.statusCode === 0) {
      return unavailableInstitution(id);
    }
    throw error;
  }
}
