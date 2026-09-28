/**
 * Board marks conversion.
 * target = min(targetMax, max(0, sourceMarks * (targetMax / sourceMax) * creditFactor))
 * rounded to 2 decimal places.
 */
export interface MarksConversionInput {
  sourceMarks: number;
  sourceMax: number;
  targetMax: number;
  creditFactor: number;
}

export function convertMarks(input: MarksConversionInput): number {
  const { sourceMarks, sourceMax, targetMax, creditFactor } = input;
  if (!(sourceMax > 0) || !(targetMax > 0) || !(creditFactor >= 0)) {
    throw new Error('Marks scales must be positive and credit factor must be non-negative');
  }
  const scaled = sourceMarks * (targetMax / sourceMax) * creditFactor;
  const capped = Math.min(targetMax, Math.max(0, scaled));
  return Math.round(capped * 100) / 100;
}
