'use client';
import { useEntityLabel } from './use-entity-label';
/**
 * Resolves an institution UUID breadcrumb segment to a human label (B3-011).
 * Falls back to the shortened id while loading or when the fetch fails.
 */
export function InstitutionBreadcrumbLabel({
  institutionId,
  fallbackLabel,
}: {
  institutionId: string;
  fallbackLabel: string;
}) {
  return <>{useEntityLabel('institutionId', institutionId, fallbackLabel)}</>;
}
