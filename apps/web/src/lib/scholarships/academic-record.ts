/**
 * PRC-M152: scholarship academic-record vocabulary and GPA scale, mirrored from
 * the scholarship backend (EDUCATION_LEVELS, eligibility.gpaScaleMax).
 * The GPA scale is configured per program by the tenant; a program without one
 * keeps the original 4.0 scale.
 */
export const EDUCATION_LEVEL_OPTIONS = [
  { value: 'primary', label: 'Primary' },
  { value: 'middle', label: 'Middle' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'senior_secondary', label: 'Senior secondary' },
  { value: 'undergraduate', label: 'Undergraduate' },
] as const;

export const DEFAULT_GPA_SCALE_MAX = 4;

/** Top of the program's GPA scale (default 4.0). */
export function programGpaScaleMax(
  eligibility: { gpaScaleMax?: number | null } | null | undefined,
): number {
  const max = eligibility?.gpaScaleMax;
  return typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : DEFAULT_GPA_SCALE_MAX;
}

/** e.g. "Enter a GPA between 0 and 10.0 (10.0 scale)." */
export function gpaRangeMessage(max: number): string {
  return `Enter a GPA between 0 and ${max.toFixed(1)} (${max.toFixed(1)} scale).`;
}
