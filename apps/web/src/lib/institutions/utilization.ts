/** Label for a grade fill ratio. Bars cap at 100%; over-full grades say so. */
export function utilizationLabel(pct: number): string {
  if (pct > 100) return 'Over capacity';
  return `${pct}%`;
}

export function utilizationWidth(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(100, pct);
}
