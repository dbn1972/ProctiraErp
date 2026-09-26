/**
 * Lookup data for institution filters and forms.
 *
 * Areas come from the institution backend's area hierarchy (`GET /areas/tree`).
 *
 * This file used to serve four hardcoded option lists built from invented
 * UUIDs (`00000000-0000-4000-8000-000000000001` "National",
 * `…010` "Primary School", …) and claimed in its own header that "production
 * deployments provide the real lookup endpoints". No such code path existed:
 * `loadTypeOptions`/`loadSectorOptions`/`loadOwnershipOptions` never called the
 * backend at all, and `loadAreaOptions` swallowed every failure and returned
 * the invented list. Because `/areas/*` was not mounted, the area call always
 * failed, so every environment showed fabricated areas — and an invented id
 * cannot satisfy `institutions.area_id REFERENCES geographic_areas(id)`, so a
 * create submitted from those options could not persist.
 *
 * Areas are now a real lookup and failures surface instead of being replaced
 * with fiction. Type / sector / ownership are not lookups at all: they persist
 * to `institutions.type|sector|ownership VARCHAR(50)`, free vocabulary columns
 * with no reference table anywhere in the schema. They are collected as text
 * with suggestions drawn from values the tenant already uses.
 */
import { listAreaTree } from './api';
import type { AreaNode } from './types';

export interface LookupOption {
  id: string;
  name: string;
}

/** Areas failed to load: the caller must say so rather than invent options. */
export interface AreaOptionsResult {
  options: LookupOption[];
  /** Present when the lookup failed. Renderable, already user-facing. */
  error: string | null;
}

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
 * Loads the tenant's area hierarchy, flattened for selects.
 *
 * Returns the failure instead of masking it. An empty list with no error means
 * the tenant genuinely has no areas yet, which is a different state from "the
 * area service could not be reached" and must be presented differently.
 */
export async function loadAreaOptionsResult(): Promise<AreaOptionsResult> {
  try {
    const tree = await listAreaTree();
    return { options: flattenAreas(tree), error: null };
  } catch (error) {
    return {
      options: [],
      error:
        error instanceof Error && error.message
          ? error.message
          : 'The area hierarchy service is currently unavailable.',
    };
  }
}

/**
 * Convenience wrapper for callers that only need the options (for example an
 * id→name map). Still never fabricates: a failure yields an empty list.
 */
export async function loadAreaOptions(): Promise<LookupOption[]> {
  return (await loadAreaOptionsResult()).options;
}

export async function loadInstitutionFormLookups(): Promise<{
  areas: LookupOption[];
  areaError: string | null;
}> {
  const areas = await loadAreaOptionsResult();
  return { areas: areas.options, areaError: areas.error };
}
