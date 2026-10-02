'use client';
import { useEntityLabel } from './use-entity-label';
/**
 * Resolves a timetable section UUID in the breadcrumb to its course name.
 */
export function SectionBreadcrumbLabel({
  sectionId,
  fallbackLabel,
}: {
  sectionId: string;
  fallbackLabel: string;
}) {
  return <>{useEntityLabel('sectionId', sectionId, fallbackLabel)}</>;
}
