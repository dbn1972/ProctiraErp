/**
 * PRC-M051: institution-type links use real type ids from the directory, and an
 * unknown `typeId` is surfaced as an invalid filter instead of an empty list.
 */
import type { InstitutionFilterOptions } from './api';

export function typeTileHref(type: { id: string }): string {
  return `/schools?typeId=${encodeURIComponent(type.id)}`;
}

export type TypeFilterState = 'none' | 'valid' | 'invalid' | 'unknown';

/**
 * `unknown` when the options could not be loaded (do not claim the filter is
 * invalid during an outage).
 */
export function resolveTypeFilter(
  typeId: string | undefined,
  options: InstitutionFilterOptions | null,
): TypeFilterState {
  if (!typeId) return 'none';
  if (!options) return 'unknown';
  return options.types.some((type) => type.id === typeId) ? 'valid' : 'invalid';
}
