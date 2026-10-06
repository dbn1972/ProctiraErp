/**
 * Lookup data sources for institution forms (areas, types, sectors, ownership).
 *
 * These options are typically served by the institution backend's metadata
 * endpoints. When those endpoints are unreachable in development we fall back
 * to a small static set so the UI remains usable. Production deployments
 * provide the real lookup endpoints via the API gateway.
 */
import { listAreaTree } from './api';
import type { AreaNode } from './types';

export interface LookupOption {
  id: string;
  name: string;
}

/**
 * Static type/sector/ownership catalogue. PRC-M155 (PARTIAL): the institution
 * backend has no catalogue endpoints yet, and existing rows reference these ids,
 * so they stay until a catalogue API + seed + remap migration lands.
 * Areas no longer have a fake fallback (PRC-M155): a failed area read is an
 * error state, never invented options.
 */

const FALLBACK_TYPES: LookupOption[] = [
  { id: '00000000-0000-4000-8000-000000000010', name: 'Primary School' },
  { id: '00000000-0000-4000-8000-000000000011', name: 'Secondary School' },
  { id: '00000000-0000-4000-8000-000000000012', name: 'University' },
];

const FALLBACK_SECTORS: LookupOption[] = [
  { id: '00000000-0000-4000-8000-000000000020', name: 'Public' },
  { id: '00000000-0000-4000-8000-000000000021', name: 'Private' },
  { id: '00000000-0000-4000-8000-000000000022', name: 'Faith-based' },
];

const FALLBACK_OWNERSHIPS: LookupOption[] = [
  { id: '00000000-0000-4000-8000-000000000030', name: 'Government' },
  { id: '00000000-0000-4000-8000-000000000031', name: 'Private' },
  { id: '00000000-0000-4000-8000-000000000032', name: 'Mixed' },
];

function flattenAreas(nodes: AreaNode[], depth = 0): LookupOption[] {
  return nodes.flatMap((node) => {
    const indent = '— '.repeat(depth);
    const self: LookupOption = { id: node.id, name: `${indent}${node.name}` };
    return node.children && node.children.length > 0
      ? [self, ...flattenAreas(node.children, depth + 1)]
      : [self];
  });
}

/**
 * PRC-M155: loads area options and reports whether the read failed. Never
 * substitutes invented areas.
 */
export async function loadAreaOptionsResult(): Promise<{ data: LookupOption[]; error: boolean }> {
  try {
    const tree = await listAreaTree();
    return { data: flattenAreas(tree), error: false };
  } catch (error) {
    // eslint-disable-next-line no-console -- server-side diagnostic for a failed lookup read
    console.error('[institutions] failed to load areas', error);
    return { data: [], error: true };
  }
}

/**
 * Loads area options for filter UIs and label resolution. Returns an empty list
 * on failure (PRC-M155: no fake fallback). `options.fallback` is accepted for
 * backwards compatibility and ignored.
 */
export async function loadAreaOptions(_options?: { fallback?: boolean }): Promise<LookupOption[]> {
  return (await loadAreaOptionsResult()).data;
}

export async function loadTypeOptions(): Promise<LookupOption[]> {
  return Promise.resolve(FALLBACK_TYPES);
}

export async function loadSectorOptions(): Promise<LookupOption[]> {
  return Promise.resolve(FALLBACK_SECTORS);
}

export async function loadOwnershipOptions(): Promise<LookupOption[]> {
  return Promise.resolve(FALLBACK_OWNERSHIPS);
}

export async function loadInstitutionFormLookups() {
  const [areas, types, sectors, ownerships] = await Promise.all([
    loadAreaOptionsResult(),
    loadTypeOptions(),
    loadSectorOptions(),
    loadOwnershipOptions(),
  ]);
  /** Lookups that failed to load; the form shows an alert and disables submit. */
  const lookupErrors: string[] = areas.error ? ['areas'] : [];
  return { areas: areas.data, types, sectors, ownerships, lookupErrors };
}

/**
 * Resolve a lookup id to a human label. Falls back to a title-cased slug when the
 * institution API returns codes like `school` / `private` instead of lookup UUIDs.
 */
export function resolveLookupLabel(options: LookupOption[], id: string): string {
  const matched = options.find((o) => o.id === id);
  if (matched) {
    return matched.name.replace(/^(—\s)+/, '').trim();
  }
  if (!id) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return '';
  }
  // Stored labels such as "Pre-Primary" already contain capitals or spaces.
  // Slugs such as "school" and "pre-primary" are title-cased.
  if (/[A-Z]/.test(id.slice(1)) || /\s/.test(id)) return id.trim();
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ');
}
