/**
 * Client-side pre-check for assessment result scores (PRC-L230).
 *
 * Each assessment item carries its own `minScore`/`maxScore`; the backend
 * (assessment result-service) rejects scores outside that item range, so the
 * client validates against the same bounds rather than the grading scheme.
 */
export interface ScoreRangeItem {
  name: string;
  minScore: number;
  maxScore: number;
}

/** Returns an error message when `raw` is not a finite score in the item range. */
export function itemScoreError(item: ScoreRangeItem, raw: string): string | null {
  const score = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(score)) {
    return `${item.name}: score must be a number`;
  }
  if (score < item.minScore || score > item.maxScore) {
    return `${item.name}: score ${score} is outside the item range [${item.minScore}, ${item.maxScore}]`;
  }
  return null;
}
