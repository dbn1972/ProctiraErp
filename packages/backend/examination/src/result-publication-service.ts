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
import { randomUUID } from 'node:crypto';

import {
  NotFoundError,
  BusinessRuleError,
  ValidationError,
  type FieldError,
} from '@proctira/common';

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
  CandidateSubjectResult,
} from './result-repository.js';
import { fingerprintCandidates } from './result-repository.js';

/** Marks entry payload (see RecordMarksSchema). */
export interface RecordMarksInput {
  entries: Array<{
    studentId: string;
    gender?: ExaminationCandidate['gender'];
    areaId?: string;
    marks: Array<{ subjectId: string; score: number | null }>;
  }>;
}

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
    private readonly options: {
      /** PRC-H057: unresolved double-entry variance pairs block publication. */
      countUnresolvedVariances?: (tenantId: string, examinationId: string) => Promise<number>;
      /** PRC-M236: receives MAX_PUBLICATION_DURATION_MS breaches. */
      logger?: { warn(obj: Record<string, unknown>, msg: string): void };
    } = {},
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

    // PRC-H057: never publish while double-entry marks variances are unresolved.
    if (this.options.countUnresolvedVariances) {
      const unresolved = await this.options.countUnresolvedVariances(tenantId, examinationId);
      if (unresolved > 0) {
        throw new BusinessRuleError(
          `Cannot publish results: ${unresolved} marks variance pair(s) are unresolved. Resolve them first.`,
        );
      }
    }
    // PRC-H056: the candidate population is the non-cancelled registrations
    // (plus any legacy result-store rows without a registration), and each
    // candidate's required subjects are their registration subjectIds.
    const [storedCandidates, registrations] = await Promise.all([
      this.resultRepository.getCandidates(examinationId, tenantId),
      this.examinationRepository.listCandidateRegistrations(examinationId, tenantId),
    ]);
    const registrationByStudent = new Map(registrations.map((r) => [r.studentId, r]));
    const storedStudentIds = new Set(storedCandidates.map((c) => c.studentId));
    const allExamSubjectIds = examination.subjects.map((s) => s.id);

    const population: Array<{
      candidateId: string;
      studentId: string;
      requiredSubjectIds: string[];
      subjectResults: ExaminationCandidate['subjectResults'];
    }> = [];
    for (const candidate of storedCandidates) {
      const registration = registrationByStudent.get(candidate.studentId);
      if (registration?.status === 'CANCELLED') continue;
      population.push({
        candidateId: candidate.id,
        studentId: candidate.studentId,
        requiredSubjectIds: registration ? registration.subjectIds : allExamSubjectIds,
        subjectResults: candidate.subjectResults,
      });
    }
    for (const registration of registrations) {
      if (registration.status === 'CANCELLED' || storedStudentIds.has(registration.studentId)) {
        continue;
      }
      // Registered but no marks row at all: every registered subject is incomplete.
      population.push({
        candidateId: registration.id,
        studentId: registration.studentId,
        requiredSubjectIds: registration.subjectIds,
        subjectResults: [],
      });
    }

    const gradeResults: CandidateGradeResult[] = [];
    const incompleteRecords: IncompleteRecord[] = [];
    let processedCount = 0;

    // Process each candidate
    for (const candidate of population) {
      // PRC-H056: a registered subject with no marks row is flagged incomplete
      // instead of being silently dropped.
      const recordedSubjectIds = new Set(candidate.subjectResults.map((r) => r.subjectId));
      for (const subjectId of new Set(candidate.requiredSubjectIds)) {
        if (!recordedSubjectIds.has(subjectId)) {
          incompleteRecords.push({
            candidateId: candidate.candidateId,
            studentId: candidate.studentId,
            subjectId,
            reason: 'No marks recorded for subject',
          });
        }
      }
      for (const subjectResult of candidate.subjectResults) {
        // Requirement 10.5: If result data is incomplete, skip and flag
        if (!subjectResult.isComplete || subjectResult.score === null) {
          incompleteRecords.push({
            candidateId: candidate.candidateId,
            studentId: candidate.studentId,
            subjectId: subjectResult.subjectId,
            reason:
              subjectResult.score === null
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
            candidateId: candidate.candidateId,
            studentId: candidate.studentId,
            subjectId: subjectResult.subjectId,
            reason: 'No grading scheme found for subject',
          });
          continue;
        }

        // Calculate grade (PRC-H054: out-of-range / unbanded scores are incomplete)
        const grade = calculateGrade(subjectResult.score, gradingScheme);
        if (grade === null) {
          incompleteRecords.push({
            candidateId: candidate.candidateId,
            studentId: candidate.studentId,
            subjectId: subjectResult.subjectId,
            reason: `Score ${subjectResult.score} does not map to a grade band in scheme '${gradingScheme.name}'`,
          });
          continue;
        }
        const passed = subjectResult.score >= gradingScheme.passThreshold;

        gradeResults.push({
          candidateId: candidate.candidateId,
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
    // PRC-M236: surface breaches of the publication duration budget.
    if (durationMs > MAX_PUBLICATION_DURATION_MS) {
      this.options.logger?.warn(
        { tenantId, examinationId, durationMs, budgetMs: MAX_PUBLICATION_DURATION_MS },
        'exam result publication exceeded its duration budget',
      );
    }
    // Build publication result
    const publicationResult: PublicationResult = {
      examinationId,
      tenantId,
      publishedAt: new Date(),
      totalCandidates: population.length,
      processedCount,
      incompleteCount: incompleteRecords.length,
      gradeResults,
      incompleteRecords,
      durationMs,
    };

    // Save publication result
    // PRC-M239: reject the publish (409) if marks changed after the snapshot above.
    await this.resultRepository.savePublicationResult(publicationResult, {
      candidatesFingerprint: fingerprintCandidates(storedCandidates),
    });

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
    const publicationResult = await this.resultRepository.getPublicationResult(
      examinationId,
      tenantId,
    );
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
      meanScore:
        allScores.length > 0
          ? roundToTwo(allScores.reduce((a, b) => a + b, 0) / allScores.length)
          : 0,
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
   * Marks entry before publication (G-902 Results tab "Upload marks").
   *
   * Each entry references a registered candidate; centerId is inferred from
   * the registration. Scores are range-checked against the subject maxScore.
   * Rejected once results are published (BusinessRuleError → 422).
   */
  async recordMarks(
    tenantId: string,
    examinationId: string,
    input: RecordMarksInput,
  ): Promise<{ candidateCount: number; subjectResultCount: number }> {
    const examination = await this.examinationRepository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }
    if (examination.status === 'CANCELLED') {
      throw new BusinessRuleError('Cannot record marks for a cancelled examination');
    }
    const published = await this.resultRepository.getPublicationResult(examinationId, tenantId);
    if (published) {
      throw new BusinessRuleError(
        'Results are already published for this examination; marks are locked',
      );
    }

    const subjectsById = new Map(examination.subjects.map((s) => [s.id, s]));
    const registrations = await this.examinationRepository.listCandidateRegistrations(
      examinationId,
      tenantId,
    );
    const registrationByStudent = new Map(registrations.map((r) => [r.studentId, r]));
    const existing = await this.resultRepository.getCandidates(examinationId, tenantId);
    const existingByStudent = new Map(existing.map((c) => [c.studentId, c]));

    const errors: FieldError[] = [];
    const upserts: ExaminationCandidate[] = [];
    let subjectResultCount = 0;
    const seenStudents = new Set<string>();

    input.entries.forEach((entry, entryIndex) => {
      // PRC-L304: duplicate student entries would build divergent upserts from
      // the same snapshot (last write wins silently) — reject them.
      if (seenStudents.has(entry.studentId)) {
        errors.push({
          field: `entries[${entryIndex}].studentId`,
          rule: 'unique',
          message: `Student '${entry.studentId}' appears more than once in this request`,
        });
        return;
      }
      seenStudents.add(entry.studentId);
      const registration = registrationByStudent.get(entry.studentId);
      if (!registration) {
        errors.push({
          field: `entries[${entryIndex}].studentId`,
          rule: 'registered',
          message: `Student '${entry.studentId}' is not registered for this examination`,
        });
        return;
      }
      const current = existingByStudent.get(entry.studentId);
      const candidateId = current?.id ?? randomUUID();
      // PRC-M239: send only this entry's subjects; the repository merges them per
      // subject into the locked stored row (no stale-snapshot overwrite).
      const results = new Map<string, CandidateSubjectResult>();
      const seenSubjects = new Set<string>();
      entry.marks.forEach((mark, markIndex) => {
        if (seenSubjects.has(mark.subjectId)) {
          errors.push({
            field: `entries[${entryIndex}].marks[${markIndex}].subjectId`,
            rule: 'unique',
            message: `Subject '${mark.subjectId}' appears more than once for this student`,
          });
          return;
        }
        seenSubjects.add(mark.subjectId);
        const subject = subjectsById.get(mark.subjectId);
        if (!subject) {
          errors.push({
            field: `entries[${entryIndex}].marks[${markIndex}].subjectId`,
            rule: 'exists',
            message: `Subject '${mark.subjectId}' is not part of this examination`,
          });
          return;
        }
        if (mark.score !== null && (mark.score < 0 || mark.score > subject.maxScore)) {
          errors.push({
            field: `entries[${entryIndex}].marks[${markIndex}].score`,
            rule: 'range',
            message: `Score for ${subject.code} must be between 0 and ${subject.maxScore}`,
          });
          return;
        }
        results.set(mark.subjectId, {
          candidateId,
          subjectId: mark.subjectId,
          score: mark.score,
          isComplete: mark.score !== null,
        });
        subjectResultCount += 1;
      });
      upserts.push({
        id: candidateId,
        examinationId,
        studentId: entry.studentId,
        centerId: registration.centerId,
        gender: current?.gender ?? entry.gender ?? 'other',
        areaId: current?.areaId ?? entry.areaId ?? registration.centerId,
        subjectResults: [...results.values()],
      });
    });

    if (errors.length > 0) {
      throw new ValidationError('Marks entry failed validation', errors);
    }

    // PRC-M239: published-check + per-subject merge happen atomically under a lock.
    await this.resultRepository.mergeCandidateMarks(tenantId, examinationId, upserts);
    return { candidateCount: upserts.length, subjectResultCount };
  }

  /** Recorded (pre- or post-publication) marks per candidate. */
  async getMarks(tenantId: string, examinationId: string): Promise<ExaminationCandidate[]> {
    const examination = await this.examinationRepository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }
    return this.resultRepository.getCandidates(examinationId, tenantId);
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
      const bucketMax =
        i === SCORE_DISTRIBUTION_BUCKETS - 1 ? maxScore : minScore + (i + 1) * bucketSize;

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
        meanScore:
          scores.length > 0 ? roundToTwo(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
        scoreDistribution: this.buildScoreDistribution(scores, minScore, maxScore),
      });
    }

    return breakdowns;
  }
}

/**
 * Calculate the grade for a score (PRC-H054).
 *
 * Grade = the band with the greatest minScore <= score, provided the score lies
 * within the scheme range [minScore, maxScore]. Returns null when the score is
 * outside the scheme range or no band starts at/below it; callers must flag
 * such results as incomplete rather than defaulting to the lowest grade.
 */
export function calculateGrade(score: number, scheme: ExaminationGradingScheme): string | null {
  if (!Number.isFinite(score) || score < scheme.minScore || score > scheme.maxScore) {
    return null;
  }
  let match: ExaminationGradingScheme['thresholds'][number] | undefined;
  for (const threshold of scheme.thresholds) {
    if (threshold.minScore <= score && (!match || threshold.minScore > match.minScore)) {
      match = threshold;
    }
  }
  return match?.grade ?? null;
}

/**
 * Round a number to two decimal places.
 */
function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}
