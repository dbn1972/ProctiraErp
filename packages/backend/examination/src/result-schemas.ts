/**
 * Typebox schemas for Result Publication and Analysis endpoints.
 *
 * Requirements:
 * - 10.4: Result publication with grade calculation
 * - 10.5: Incomplete result handling
 * - 10.8: Result analysis with breakdowns
 */
import { Type, type Static } from '@sinclair/typebox';

// UUID pattern for validation
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/**
 * Path params for examination-scoped result operations.
 */
export const ResultExaminationParamsSchema = Type.Object({
  examinationId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Examination UUID',
  }),
});

export type ResultExaminationParams = Static<typeof ResultExaminationParamsSchema>;

/**
 * Marks entry payload (G-902). `score: null` records an incomplete subject.
 */
export const RecordMarksSchema = Type.Object({
  entries: Type.Array(
    Type.Object({
      studentId: Type.String({ pattern: UUID_PATTERN }),
      gender: Type.Optional(
        Type.Union([Type.Literal('male'), Type.Literal('female'), Type.Literal('other')]),
      ),
      areaId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
      marks: Type.Array(
        Type.Object({
          subjectId: Type.String({ pattern: UUID_PATTERN }),
          score: Type.Union([Type.Number(), Type.Null()]),
        }),
        { minItems: 1 },
      ),
    }),
    { minItems: 1, maxItems: 500 },
  ),
});

export type RecordMarksBody = Static<typeof RecordMarksSchema>;

/**
 * Score distribution bucket in analysis response.
 */
export const ScoreDistributionBucketSchema = Type.Object({
  rangeLabel: Type.String({ description: 'Human-readable range label (e.g., "0-10")' }),
  minScore: Type.Number({ description: 'Bucket minimum score' }),
  maxScore: Type.Number({ description: 'Bucket maximum score' }),
  count: Type.Number({ description: 'Number of scores in this bucket' }),
  percentage: Type.Number({ description: 'Percentage of total scores in this bucket' }),
});

/**
 * Analysis breakdown schema for a single dimension value.
 */
export const AnalysisBreakdownSchema = Type.Object({
  dimensionId: Type.String({
    description: 'Dimension identifier (subject ID, center ID, gender, area ID)',
  }),
  dimensionName: Type.String({ description: 'Human-readable dimension name' }),
  totalCandidates: Type.Number({ description: 'Total unique candidates in this group' }),
  passCount: Type.Number({ description: 'Number of passing results' }),
  failCount: Type.Number({ description: 'Number of failing results' }),
  passRate: Type.Number({ description: 'Pass rate percentage (0-100)' }),
  meanScore: Type.Number({ description: 'Mean score for this group' }),
  scoreDistribution: Type.Array(ScoreDistributionBucketSchema, {
    description: 'Score distribution buckets',
  }),
});

/**
 * Publication result response schema.
 */
export const PublicationResultResponseSchema = Type.Object({
  examinationId: Type.String({ description: 'Examination UUID' }),
  publishedAt: Type.String({ description: 'Publication timestamp (ISO 8601)' }),
  totalCandidates: Type.Number({ description: 'Total candidates in the examination' }),
  processedCount: Type.Number({ description: 'Number of subject-results successfully processed' }),
  incompleteCount: Type.Number({ description: 'Number of records flagged as incomplete' }),
  durationMs: Type.Number({ description: 'Processing duration in milliseconds' }),
  gradeResults: Type.Array(
    Type.Object({
      candidateId: Type.String(),
      studentId: Type.String(),
      subjectId: Type.String(),
      score: Type.Number(),
      grade: Type.String(),
      passed: Type.Boolean(),
    }),
    { description: 'Computed grade results' },
  ),
  incompleteRecords: Type.Array(
    Type.Object({
      candidateId: Type.String(),
      studentId: Type.String(),
      subjectId: Type.String(),
      reason: Type.String(),
    }),
    { description: 'Records flagged as incomplete' },
  ),
});

export type PublicationResultResponse = Static<typeof PublicationResultResponseSchema>;

/**
 * Result analysis response schema.
 */
export const ResultAnalysisResponseSchema = Type.Object({
  examinationId: Type.String({ description: 'Examination UUID' }),
  generatedAt: Type.String({ description: 'Analysis generation timestamp (ISO 8601)' }),
  overall: Type.Object({
    totalCandidates: Type.Number(),
    passCount: Type.Number(),
    failCount: Type.Number(),
    incompleteCount: Type.Number(),
    passRate: Type.Number({ description: 'Overall pass rate percentage' }),
    meanScore: Type.Number({ description: 'Overall mean score' }),
    scoreDistribution: Type.Array(ScoreDistributionBucketSchema),
  }),
  bySubject: Type.Array(AnalysisBreakdownSchema, { description: 'Breakdown by subject' }),
  byCenter: Type.Array(AnalysisBreakdownSchema, { description: 'Breakdown by center' }),
  byGender: Type.Array(AnalysisBreakdownSchema, { description: 'Breakdown by gender' }),
  byArea: Type.Array(AnalysisBreakdownSchema, { description: 'Breakdown by area' }),
});

export type ResultAnalysisResponse = Static<typeof ResultAnalysisResponseSchema>;
