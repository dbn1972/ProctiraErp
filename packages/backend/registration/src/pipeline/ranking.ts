export interface MeritWeights {
  interview: number;
  test: number;
}

export interface RankableCandidate {
  applicationId: string;
  interviewScore: number;
  testScore: number;
  submittedAt: Date;
}

export interface RankedCandidate extends RankableCandidate {
  rank: number;
  score: number;
}

const WEIGHT_SUM_EPSILON = 1e-6;

export function assertMeritWeights(weights: MeritWeights): void {
  if (
    !Number.isFinite(weights.interview) ||
    !Number.isFinite(weights.test) ||
    weights.interview < 0 ||
    weights.test < 0
  ) {
    throw new Error('Merit weights must be finite and non-negative');
  }
  const sum = weights.interview + weights.test;
  if (Math.abs(sum - 1) > WEIGHT_SUM_EPSILON) {
    throw new Error('Merit weights must sum to 1');
  }
}

export function compositeScore(candidate: RankableCandidate, weights: MeritWeights): number {
  return weights.interview * candidate.interviewScore + weights.test * candidate.testScore;
}

/**
 * Deterministic ranking: higher composite score, then higher test, then higher
 * interview, then earlier submission, then application id (lexicographic).
 */
export function rankCandidates(
  candidates: RankableCandidate[],
  weights: MeritWeights,
): RankedCandidate[] {
  assertMeritWeights(weights);
  const sorted = [...candidates].sort((a, b) => {
    const scoreDelta = compositeScore(b, weights) - compositeScore(a, weights);
    if (scoreDelta !== 0) return scoreDelta;
    if (b.testScore !== a.testScore) return b.testScore - a.testScore;
    if (b.interviewScore !== a.interviewScore) return b.interviewScore - a.interviewScore;
    const submittedDelta = a.submittedAt.getTime() - b.submittedAt.getTime();
    if (submittedDelta !== 0) return submittedDelta;
    return a.applicationId.localeCompare(b.applicationId);
  });
  return sorted.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    score: compositeScore(candidate, weights),
  }));
}
