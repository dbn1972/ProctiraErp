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
 * Static fallback options used when backend lookup endpoints are unavailable.
 * Each entry uses the nil UUID structure expected by Typebox UUID validation
 * (`v4`-shaped) so users don't accidentally see invalid UUID errors during
 * local development.
 */
const FALLBACK_AREAS: LookupOption[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'National' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Region 1' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Region 2' },
];

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
 * Loads area options for filter UIs and form selects. Falls back to static
 * options if the backend area-tree endpoint is unavailable.
 */
export async function loadAreaOptions(): Promise<LookupOption[]> {
  try {
    const tree = await listAreaTree();
    const flat = flattenAreas(tree);
    return flat.length > 0 ? flat : FALLBACK_AREAS;
  } catch {
    return FALLBACK_AREAS;
  }
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
    loadAreaOptions(),
    loadTypeOptions(),
    loadSectorOptions(),
    loadOwnershipOptions(),
  ]);
  return { areas, types, sectors, ownerships };
}
