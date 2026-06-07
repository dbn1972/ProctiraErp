/**
 * Result Publication Service
 *
 * Business logic for examination result publication, grade calculation,
 * and result analysis generation.
 *
 * Requirements:
 * - 10.4: Calculate final grades using assigned grading scheme and update student
 *         academic records within 30 seconds of publication trigger
 * - 10.5: Handle incomplete result data: skip candidate, flag as incomplete, continue
 * - 10.8: Provide result analysis including pass rate, mean score, and score distribution
 *         broken down by subject, center, gender, and area
 */
import { NotFoundError, BusinessRuleError } from '@proctira/common';

import type { ExaminationRepository, ExaminationGradingScheme } from './examination-repository.js';
import type {
  ResultRepository,
  ExaminationCandidate,
  CandidateGradeResult,
  IncompleteRecord,
  PublicationResult,
  ResultAnalysis,
  AnalysisBreakdown,
  ScoreDistributionBucket,
  AcademicRecordUpdate,
} from './result-repository.js';

/** Maximum allowed publication duration in milliseconds (30 seconds) */
export const MAX_PUBLICATION_DURATION_MS = 30_000;

/** Number of buckets for score distribution */
export const SCORE_DISTRIBUTION_BUCKETS = 10;

/**
 * Service handling result publication and analysis.
 */
export class ResultPublicationService {
  constructor(
    private readonly examinationRepository: ExaminationRepository,
    private readonly resultRepository: ResultRepository,
  ) {}

  /**
   * Publish examination results.
   *
   * Calculates final grades for all candidates using the assigned grading scheme,
   * handles incomplete data gracefully, and updates student academic records.
   *
   * @throws NotFoundError if examination not found
   * @throws BusinessRuleError if examination is not in a publishable state
   */
  async publishResults(tenantId: string, examinationId: string): Promise<PublicationResult> {
    const startTime = Date.now();

    // Fetch examination
    const examination = await this.examinationRepository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }

    // Examination must be IN_PROGRESS or COMPLETED to publish results
    if (examination.status !== 'IN_PROGRESS' && examination.status !== 'COMPLETED') {
      throw new BusinessRuleError(
        `Cannot publish results for examination in '${examination.status}' status. Examination must be IN_PROGRESS or COMPLETED.`,
      );
    }

    // Fetch all candidates
    const candidates = await this.resultRepository.getCandidates(examinationId, tenantId);

    const gradeResults: CandidateGradeResult[] = [];
    const incompleteRecords: IncompleteRecord[] = [];
    let processedCount = 0;

    // Process each candidate
    for (const candidate of candidates) {
      for (const subjectResult of candidate.subjectResults) {
        // Requirement 10.5: If result data is incomplete, skip and flag
        if (!subjectResult.isComplete || subjectResult.score === null) {
          incompleteRecords.push({
            candidateId: candidate.id,
            studentId: candidate.studentId,
            subjectId: subjectResult.subjectId,
            reason: subjectResult.score === null
              ? 'Score data is missing'
              : 'Result data is marked as incomplete',
          });
          continue;
        }

        // Find the grading scheme for this subject
        const subject = examination.subjects.find((s) => s.id === subjectResult.subjectId);
        const gradingScheme = this.resolveGradingScheme(
          examination.gradingSchemes,
          subject?.gradingSchemeId,
        );

        if (!gradingScheme) {
          incompleteRecords.push({
            candidateId: candidate.id,
            studentId: candidate.studentId,
            subjectId: subjectResult.subjectId,
            reason: 'No grading scheme found for subject',
          });
          continue;
        }

        // Calculate grade
        const grade = this.calculateGrade(subjectResult.score, gradingScheme);
        const passed = subjectResult.score >= gradingScheme.passThreshold;

        gradeResults.push({
          candidateId: candidate.id,
          studentId: candidate.studentId,
          subjectId: subjectResult.subjectId,
          score: subjectResult.score,
          grade,
          passed,
        });

        processedCount++;
      }
    }

    const durationMs = Date.now() - startTime;

    // Build publication result
    const publicationResult: PublicationResult = {
      examinationId,
      tenantId,
      publishedAt: new Date(),
      totalCandidates: candidates.length,
      processedCount,
      incompleteCount: incompleteRecords.length,
      gradeResults,
      incompleteRecords,
      durationMs,
    };

    // Save publication result
    await this.resultRepository.savePublicationResult(publicationResult);

    // Requirement 10.4: Update student academic records
    const academicUpdates: AcademicRecordUpdate[] = gradeResults.map((gr) => ({
      studentId: gr.studentId,
      examinationId,
      subjectId: gr.subjectId,
      score: gr.score,
      grade: gr.grade,
      passed: gr.passed,
      publishedAt: publicationResult.publishedAt,
    }));

    if (academicUpdates.length > 0) {
      await this.resultRepository.updateAcademicRecords(tenantId, academicUpdates);
    }

    // Update examination status to COMPLETED if not already
    if (examination.status !== 'COMPLETED') {
      await this.examinationRepository.update(examinationId, tenantId, { status: 'COMPLETED' });
    }

    return publicationResult;
  }

  /**
   * Generate result analysis for a published examination.
   *
   * Requirement 10.8: Provides pass rate, mean score, and score distribution
   * broken down by subject, center, gender, and area.
   *
   * @throws NotFoundError if examination not found
   * @throws BusinessRuleError if results have not been published
   */
  async generateAnalysis(tenantId: string, examinationId: string): Promise<ResultAnalysis> {
    // Fetch examination
    const examination = await this.examinationRepository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }

    // Fetch publication result
    const publicationResult = await this.resultRepository.getPublicationResult(examinationId, tenantId);
    if (!publicationResult) {
      throw new BusinessRuleError(
        'Results have not been published for this examination. Publish results first.',
      );
    }

    // Fetch candidates for dimension data (center, gender, area)
    const candidates = await this.resultRepository.getCandidates(examinationId, tenantId);
    const candidateMap = new Map(candidates.map((c) => [c.id, c]));

    const { gradeResults, incompleteRecords } = publicationResult;

    // Overall analysis
    const allScores = gradeResults.map((r) => r.score);
    const passCount = gradeResults.filter((r) => r.passed).length;
    const failCount = gradeResults.filter((r) => !r.passed).length;

    // Determine score range from examination grading schemes
    const minScore = Math.min(...examination.gradingSchemes.map((gs) => gs.minScore));
    const maxScore = Math.max(...examination.gradingSchemes.map((gs) => gs.maxScore));

    const overall = {
      totalCandidates: publicationResult.totalCandidates,
      passCount,
      failCount,
      incompleteCount: incompleteRecords.length,
      passRate: allScores.length > 0 ? roundToTwo((passCount / allScores.length) * 100) : 0,
      meanScore: allScores.length > 0 ? roundToTwo(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0,
      scoreDistribution: this.buildScoreDistribution(allScores, minScore, maxScore),
    };

    // By Subject
    const bySubject = this.buildBreakdownByDimension(
      gradeResults,
      candidateMap,
      (result) => result.subjectId,
      (subjectId) => {
        const subject = examination.subjects.find((s) => s.id === subjectId);
        return subject?.name ?? subjectId;
      },
      minScore,
      maxScore,
    );

    // By Center
    const byCenter = this.buildBreakdownByDimension(
      gradeResults,
      candidateMap,
      (result) => {
        const candidate = candidateMap.get(result.candidateId);
        return candidate?.centerId ?? 'unknown';
      },
      (centerId) => {
        const center = examination.centers.find((c) => c.id === centerId);
        return center?.name ?? centerId;
      },
      minScore,
      maxScore,
    );

    // By Gender
    const byGender = this.buildBreakdownByDimension(
      gradeResults,
      candidateMap,
      (result) => {
        const candidate = candidateMap.get(result.candidateId);
        return candidate?.gender ?? 'unknown';
      },
      (gender) => gender,
      minScore,
      maxScore,
    );

    // By Area
    const byArea = this.buildBreakdownByDimension(
      gradeResults,
      candidateMap,
      (result) => {
        const candidate = candidateMap.get(result.candidateId);
        return candidate?.areaId ?? 'unknown';
      },
      (areaId) => areaId,
      minScore,
      maxScore,
    );

    const analysis: ResultAnalysis = {
      examinationId,
      tenantId,
      generatedAt: new Date(),
      overall,
      bySubject,
      byCenter,
      byGender,
      byArea,
    };

    // Save analysis
    await this.resultRepository.saveResultAnalysis(analysis);

    return analysis;
  }

  /**
   * Get previously generated result analysis.
   *
   * @throws NotFoundError if examination or analysis not found
   */
  async getAnalysis(tenantId: string, examinationId: string): Promise<ResultAnalysis> {
    const examination = await this.examinationRepository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }

    const analysis = await this.resultRepository.getResultAnalysis(examinationId, tenantId);
    if (!analysis) {
      throw new NotFoundError('Result analysis not found. Generate analysis first.');
    }

    return analysis;
  }

  /**
   * Get publication result for an examination.
   *
   * @throws NotFoundError if examination or publication result not found
   */
  async getPublicationResult(tenantId: string, examinationId: string): Promise<PublicationResult> {
    const examination = await this.examinationRepository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }

    const result = await this.resultRepository.getPublicationResult(examinationId, tenantId);
    if (!result) {
      throw new NotFoundError('Publication result not found. Publish results first.');
    }

    return result;
  }

  /**
   * Resolve the grading scheme for a subject.
   * If the subject has a specific gradingSchemeId, use that.
   * Otherwise, use the first grading scheme in the examination.
   */
  private resolveGradingScheme(
    schemes: ExaminationGradingScheme[],
    gradingSchemeId?: string,
  ): ExaminationGradingScheme | undefined {
    if (gradingSchemeId) {
      return schemes.find((s) => s.id === gradingSchemeId);
    }
    return schemes[0];
  }

  /**
   * Calculate the grade for a given score using the grading scheme thresholds.
   * Returns the grade label that matches the score range.
   */
  private calculateGrade(score: number, scheme: ExaminationGradingScheme): string {
    // Sort thresholds by minScore descending to find the highest matching grade
    const sortedThresholds = [...scheme.thresholds].sort((a, b) => b.minScore - a.minScore);

    for (const threshold of sortedThresholds) {
      if (score >= threshold.minScore && score <= threshold.maxScore) {
        return threshold.grade;
      }
    }

    // If no threshold matches, return the lowest grade
    const lowestThreshold = [...scheme.thresholds].sort((a, b) => a.minScore - b.minScore)[0];
    return lowestThreshold?.grade ?? 'N/A';
  }

  /**
   * Build score distribution buckets for a set of scores.
   */
  private buildScoreDistribution(
    scores: number[],
    minScore: number,
    maxScore: number,
  ): ScoreDistributionBucket[] {
    if (scores.length === 0) {
      return [];
    }

    const range = maxScore - minScore;
    const bucketSize = range / SCORE_DISTRIBUTION_BUCKETS;
    const buckets: ScoreDistributionBucket[] = [];

    for (let i = 0; i < SCORE_DISTRIBUTION_BUCKETS; i++) {
      const bucketMin = minScore + i * bucketSize;
      const bucketMax = i === SCORE_DISTRIBUTION_BUCKETS - 1
        ? maxScore
        : minScore + (i + 1) * bucketSize;

      const count = scores.filter((s) => {
        if (i === SCORE_DISTRIBUTION_BUCKETS - 1) {
          return s >= bucketMin && s <= bucketMax;
        }
        return s >= bucketMin && s < bucketMax;
      }).length;

      buckets.push({
        rangeLabel: `${Math.round(bucketMin)}-${Math.round(bucketMax)}`,
        minScore: roundToTwo(bucketMin),
        maxScore: roundToTwo(bucketMax),
        count,
        percentage: scores.length > 0 ? roundToTwo((count / scores.length) * 100) : 0,
      });
    }

    return buckets;
  }

  /**
   * Build analysis breakdown by a given dimension (subject, center, gender, area).
   */
  private buildBreakdownByDimension(
    gradeResults: CandidateGradeResult[],
    candidateMap: Map<string, ExaminationCandidate>,
    getDimensionId: (result: CandidateGradeResult) => string,
    getDimensionName: (dimensionId: string) => string,
    minScore: number,
    maxScore: number,
  ): AnalysisBreakdown[] {
    // Group results by dimension
    const groups = new Map<string, CandidateGradeResult[]>();

    for (const result of gradeResults) {
      const dimensionId = getDimensionId(result);
      const existing = groups.get(dimensionId) ?? [];
      existing.push(result);
      groups.set(dimensionId, existing);
    }

    // Build breakdown for each group
    const breakdowns: AnalysisBreakdown[] = [];

    for (const [dimensionId, results] of groups) {
      const scores = results.map((r) => r.score);
      const passCount = results.filter((r) => r.passed).length;
      const failCount = results.filter((r) => !r.passed).length;
      const uniqueCandidates = new Set(results.map((r) => r.candidateId)).size;

      breakdowns.push({
        dimensionId,
        dimensionName: getDimensionName(dimensionId),
        totalCandidates: uniqueCandidates,
        passCount,
        failCount,
        passRate: scores.length > 0 ? roundToTwo((passCount / scores.length) * 100) : 0,
        meanScore: scores.length > 0 ? roundToTwo(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        scoreDistribution: this.buildScoreDistribution(scores, minScore, maxScore),
      });
    }

    return breakdowns;
  }
}

/**
 * Round a number to two decimal places.
 */
function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}
