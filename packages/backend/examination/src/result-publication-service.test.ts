/**
 * Unit tests for ResultPublicationService
 *
 * Tests business logic for result publication and analysis including:
 * - Grade calculation using assigned grading scheme (Req 10.4)
 * - Incomplete result data handling: skip, flag, continue (Req 10.5)
 * - Result analysis generation with breakdowns (Req 10.8)
 * - Student academic record updates on publication (Req 10.4)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, BusinessRuleError } from '@proctira/common';

import { ResultPublicationService } from './result-publication-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import type { ExaminationEntity } from './examination-repository.js';
import type { ExaminationCandidate } from './result-repository.js';

// Helper to generate a valid UUID v4
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Helper to create a test examination entity
function createTestExamination(overrides: Partial<ExaminationEntity> = {}): ExaminationEntity {
  const examId = overrides.id ?? uuid();
  const schemeId = uuid();
  return {
    id: examId,
    tenantId: 'tenant-1',
    name: 'National Exam 2025',
    code: 'EXAM-2025',
    description: null,
    academicPeriodId: uuid(),
    startDate: '2025-06-01',
    endDate: '2025-06-15',
    status: 'IN_PROGRESS',
    subjects: [
      {
        id: 'subj-math',
        examinationId: examId,
        name: 'Mathematics',
        code: 'MATH',
        maxScore: 100,
        gradingSchemeId: schemeId,
      },
      {
        id: 'subj-eng',
        examinationId: examId,
        name: 'English',
        code: 'ENG',
        maxScore: 100,
        gradingSchemeId: schemeId,
      },
    ],
    centers: [
      {
        id: 'center-1',
        examinationId: examId,
        name: 'Center A',
        code: 'CTR-A',
        institutionId: uuid(),
        capacity: 200,
      },
      {
        id: 'center-2',
        examinationId: examId,
        name: 'Center B',
        code: 'CTR-B',
        institutionId: uuid(),
        capacity: 150,
      },
    ],
    sessions: [],
    gradingSchemes: [
      {
        id: schemeId,
        examinationId: examId,
        name: 'Standard Grading',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'B', minScore: 60, maxScore: 79 },
          { grade: 'C', minScore: 40, maxScore: 59 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Helper to create test candidates
function createTestCandidates(examinationId: string): ExaminationCandidate[] {
  return [
    {
      id: 'cand-1',
      examinationId,
      studentId: 'student-1',
      centerId: 'center-1',
      gender: 'male',
      areaId: 'area-1',
      subjectResults: [
        { candidateId: 'cand-1', subjectId: 'subj-math', score: 85, isComplete: true },
        { candidateId: 'cand-1', subjectId: 'subj-eng', score: 72, isComplete: true },
      ],
    },
    {
      id: 'cand-2',
      examinationId,
      studentId: 'student-2',
      centerId: 'center-1',
      gender: 'female',
      areaId: 'area-1',
      subjectResults: [
        { candidateId: 'cand-2', subjectId: 'subj-math', score: 45, isComplete: true },
        { candidateId: 'cand-2', subjectId: 'subj-eng', score: 38, isComplete: true },
      ],
    },
    {
      id: 'cand-3',
      examinationId,
      studentId: 'student-3',
      centerId: 'center-2',
      gender: 'male',
      areaId: 'area-2',
      subjectResults: [
        { candidateId: 'cand-3', subjectId: 'subj-math', score: 92, isComplete: true },
        { candidateId: 'cand-3', subjectId: 'subj-eng', score: 88, isComplete: true },
      ],
    },
  ];
}

describe('ResultPublicationService', () => {
  let service: ResultPublicationService;
  let examRepository: InMemoryExaminationRepository;
  let resultRepository: InMemoryResultRepository;
  const tenantId = 'tenant-1';

  beforeEach(() => {
    examRepository = new InMemoryExaminationRepository();
    resultRepository = new InMemoryResultRepository();
    service = new ResultPublicationService(examRepository, resultRepository);
  });

  describe('publishResults', () => {
    it('should calculate final grades using the assigned grading scheme', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));

      const result = await service.publishResults(tenantId, exam.id);

      expect(result.gradeResults).toHaveLength(6); // 3 candidates × 2 subjects
      expect(result.processedCount).toBe(6);
      expect(result.incompleteCount).toBe(0);

      // Verify grade calculation for candidate 1 - Math (85 → A)
      const cand1Math = result.gradeResults.find(
        (r) => r.candidateId === 'cand-1' && r.subjectId === 'subj-math',
      );
      expect(cand1Math).toBeDefined();
      expect(cand1Math!.grade).toBe('A');
      expect(cand1Math!.passed).toBe(true);
      expect(cand1Math!.score).toBe(85);

      // Verify grade calculation for candidate 2 - English (38 → F, failed)
      const cand2Eng = result.gradeResults.find(
        (r) => r.candidateId === 'cand-2' && r.subjectId === 'subj-eng',
      );
      expect(cand2Eng).toBeDefined();
      expect(cand2Eng!.grade).toBe('F');
      expect(cand2Eng!.passed).toBe(false);
    });

    it('should skip candidates with incomplete data and flag them', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);

      const candidates: ExaminationCandidate[] = [
        {
          id: 'cand-1',
          examinationId: exam.id,
          studentId: 'student-1',
          centerId: 'center-1',
          gender: 'male',
          areaId: 'area-1',
          subjectResults: [
            { candidateId: 'cand-1', subjectId: 'subj-math', score: 85, isComplete: true },
            { candidateId: 'cand-1', subjectId: 'subj-eng', score: null, isComplete: false }, // incomplete
          ],
        },
        {
          id: 'cand-2',
          examinationId: exam.id,
          studentId: 'student-2',
          centerId: 'center-1',
          gender: 'female',
          areaId: 'area-1',
          subjectResults: [
            { candidateId: 'cand-2', subjectId: 'subj-math', score: null, isComplete: true }, // null score
            { candidateId: 'cand-2', subjectId: 'subj-eng', score: 72, isComplete: true },
          ],
        },
      ];
      resultRepository.seedCandidates(exam.id, candidates);

      const result = await service.publishResults(tenantId, exam.id);

      // Should process 2 complete results and flag 2 incomplete
      expect(result.processedCount).toBe(2);
      expect(result.incompleteCount).toBe(2);
      expect(result.incompleteRecords).toHaveLength(2);

      // Verify incomplete records are flagged with reasons
      const incompleteEng = result.incompleteRecords.find(
        (r) => r.candidateId === 'cand-1' && r.subjectId === 'subj-eng',
      );
      expect(incompleteEng).toBeDefined();
      expect(incompleteEng!.reason.length).toBeGreaterThan(0);

      const incompleteMath = result.incompleteRecords.find(
        (r) => r.candidateId === 'cand-2' && r.subjectId === 'subj-math',
      );
      expect(incompleteMath).toBeDefined();
      expect(incompleteMath!.reason).toContain('missing');
    });

    it('should continue processing remaining candidates after encountering incomplete data', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);

      const candidates: ExaminationCandidate[] = [
        {
          id: 'cand-1',
          examinationId: exam.id,
          studentId: 'student-1',
          centerId: 'center-1',
          gender: 'male',
          areaId: 'area-1',
          subjectResults: [
            { candidateId: 'cand-1', subjectId: 'subj-math', score: null, isComplete: false }, // incomplete
            { candidateId: 'cand-1', subjectId: 'subj-eng', score: null, isComplete: false }, // incomplete
          ],
        },
        {
          id: 'cand-2',
          examinationId: exam.id,
          studentId: 'student-2',
          centerId: 'center-1',
          gender: 'female',
          areaId: 'area-1',
          subjectResults: [
            { candidateId: 'cand-2', subjectId: 'subj-math', score: 75, isComplete: true },
            { candidateId: 'cand-2', subjectId: 'subj-eng', score: 60, isComplete: true },
          ],
        },
      ];
      resultRepository.seedCandidates(exam.id, candidates);

      const result = await service.publishResults(tenantId, exam.id);

      // First candidate fully incomplete, second fully processed
      expect(result.incompleteCount).toBe(2);
      expect(result.processedCount).toBe(2);
      expect(result.gradeResults).toHaveLength(2);
      expect(result.gradeResults[0]!.candidateId).toBe('cand-2');
    });

    it('should update student academic records on publication', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));

      await service.publishResults(tenantId, exam.id);

      const academicUpdates = resultRepository.getAcademicRecordUpdates();
      expect(academicUpdates).toHaveLength(6); // 3 candidates × 2 subjects

      // Verify academic record update for student-1, Math
      const student1Math = academicUpdates.find(
        (u) => u.studentId === 'student-1' && u.subjectId === 'subj-math',
      );
      expect(student1Math).toBeDefined();
      expect(student1Math!.score).toBe(85);
      expect(student1Math!.grade).toBe('A');
      expect(student1Math!.passed).toBe(true);
      expect(student1Math!.examinationId).toBe(exam.id);
      expect(student1Math!.publishedAt).toBeInstanceOf(Date);
    });

    it('should update examination status to COMPLETED', async () => {
      const exam = createTestExamination({ status: 'IN_PROGRESS' });
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));

      await service.publishResults(tenantId, exam.id);

      const updatedExam = await examRepository.findById(exam.id, tenantId);
      expect(updatedExam!.status).toBe('COMPLETED');
    });

    it('should throw NotFoundError if examination does not exist', async () => {
      await expect(service.publishResults(tenantId, uuid())).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError if examination is in DRAFT status', async () => {
      const exam = createTestExamination({ status: 'DRAFT' });
      await examRepository.create(exam);

      await expect(service.publishResults(tenantId, exam.id)).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError if examination is CANCELLED', async () => {
      const exam = createTestExamination({ status: 'CANCELLED' });
      await examRepository.create(exam);

      await expect(service.publishResults(tenantId, exam.id)).rejects.toThrow(BusinessRuleError);
    });

    it('should handle examination with no candidates gracefully', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, []);

      const result = await service.publishResults(tenantId, exam.id);

      expect(result.totalCandidates).toBe(0);
      expect(result.processedCount).toBe(0);
      expect(result.incompleteCount).toBe(0);
      expect(result.gradeResults).toHaveLength(0);
    });

    it('should record publication duration in milliseconds', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));

      const result = await service.publishResults(tenantId, exam.id);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.durationMs).toBe('number');
    });

    it('should use the first grading scheme when subject has no specific scheme assigned', async () => {
      const examId = uuid();
      const schemeId = uuid();
      const exam = createTestExamination({
        id: examId,
        subjects: [
          {
            id: 'subj-math',
            examinationId: examId,
            name: 'Mathematics',
            code: 'MATH',
            maxScore: 100,
          }, // no gradingSchemeId
        ],
        gradingSchemes: [
          {
            id: schemeId,
            examinationId: examId,
            name: 'Default Scheme',
            minScore: 0,
            maxScore: 100,
            passThreshold: 50,
            thresholds: [
              { grade: 'P', minScore: 50, maxScore: 100 },
              { grade: 'F', minScore: 0, maxScore: 49 },
            ],
          },
        ],
      });
      await examRepository.create(exam);

      const candidates: ExaminationCandidate[] = [
        {
          id: 'cand-1',
          examinationId: examId,
          studentId: 'student-1',
          centerId: 'center-1',
          gender: 'male',
          areaId: 'area-1',
          subjectResults: [
            { candidateId: 'cand-1', subjectId: 'subj-math', score: 55, isComplete: true },
          ],
        },
      ];
      resultRepository.seedCandidates(examId, candidates);

      const result = await service.publishResults(tenantId, examId);

      expect(result.gradeResults[0]!.grade).toBe('P');
      expect(result.gradeResults[0]!.passed).toBe(true);
    });
  });

  describe('generateAnalysis', () => {
    it('should generate overall pass rate and mean score', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));

      // Publish first
      await service.publishResults(tenantId, exam.id);

      // Generate analysis
      const analysis = await service.generateAnalysis(tenantId, exam.id);

      expect(analysis.examinationId).toBe(exam.id);
      expect(analysis.overall.totalCandidates).toBe(3);
      // 5 out of 6 results pass (score >= 40): 85, 72, 45, 92, 88 pass; 38 fails
      expect(analysis.overall.passCount).toBe(5);
      expect(analysis.overall.failCount).toBe(1);
      expect(analysis.overall.passRate).toBeCloseTo(83.33, 1);
      // Mean: (85 + 72 + 45 + 38 + 92 + 88) / 6 = 420 / 6 = 70
      expect(analysis.overall.meanScore).toBe(70);
      expect(analysis.overall.scoreDistribution.length).toBeGreaterThan(0);
    });

    it('should generate breakdown by subject', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));
      await service.publishResults(tenantId, exam.id);

      const analysis = await service.generateAnalysis(tenantId, exam.id);

      expect(analysis.bySubject.length).toBe(2); // Math and English

      const mathBreakdown = analysis.bySubject.find((b) => b.dimensionId === 'subj-math');
      expect(mathBreakdown).toBeDefined();
      expect(mathBreakdown!.dimensionName).toBe('Mathematics');
      // Math scores: 85, 45, 92 → all pass (>= 40)
      expect(mathBreakdown!.passCount).toBe(3);
      expect(mathBreakdown!.failCount).toBe(0);
      expect(mathBreakdown!.passRate).toBe(100);
      // Mean: (85 + 45 + 92) / 3 = 74
      expect(mathBreakdown!.meanScore).toBeCloseTo(74, 0);

      const engBreakdown = analysis.bySubject.find((b) => b.dimensionId === 'subj-eng');
      expect(engBreakdown).toBeDefined();
      expect(engBreakdown!.dimensionName).toBe('English');
      // English scores: 72, 38, 88 → 72 and 88 pass, 38 fails
      expect(engBreakdown!.passCount).toBe(2);
      expect(engBreakdown!.failCount).toBe(1);
    });

    it('should generate breakdown by center', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));
      await service.publishResults(tenantId, exam.id);

      const analysis = await service.generateAnalysis(tenantId, exam.id);

      expect(analysis.byCenter.length).toBe(2); // center-1 and center-2

      const center1 = analysis.byCenter.find((b) => b.dimensionId === 'center-1');
      expect(center1).toBeDefined();
      expect(center1!.dimensionName).toBe('Center A');
      // Center 1 has cand-1 (85, 72) and cand-2 (45, 38) → 4 results
      expect(center1!.totalCandidates).toBe(2);

      const center2 = analysis.byCenter.find((b) => b.dimensionId === 'center-2');
      expect(center2).toBeDefined();
      expect(center2!.dimensionName).toBe('Center B');
      // Center 2 has cand-3 (92, 88) → 2 results
      expect(center2!.totalCandidates).toBe(1);
    });

    it('should generate breakdown by gender', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));
      await service.publishResults(tenantId, exam.id);

      const analysis = await service.generateAnalysis(tenantId, exam.id);

      expect(analysis.byGender.length).toBe(2); // male and female

      const maleBreakdown = analysis.byGender.find((b) => b.dimensionId === 'male');
      expect(maleBreakdown).toBeDefined();
      // Male: cand-1 (85, 72) and cand-3 (92, 88) → 4 results, all pass
      expect(maleBreakdown!.passCount).toBe(4);
      expect(maleBreakdown!.failCount).toBe(0);

      const femaleBreakdown = analysis.byGender.find((b) => b.dimensionId === 'female');
      expect(femaleBreakdown).toBeDefined();
      // Female: cand-2 (45, 38) → 1 pass, 1 fail
      expect(femaleBreakdown!.passCount).toBe(1);
      expect(femaleBreakdown!.failCount).toBe(1);
    });

    it('should generate breakdown by area', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));
      await service.publishResults(tenantId, exam.id);

      const analysis = await service.generateAnalysis(tenantId, exam.id);

      expect(analysis.byArea.length).toBe(2); // area-1 and area-2

      const area1 = analysis.byArea.find((b) => b.dimensionId === 'area-1');
      expect(area1).toBeDefined();
      // Area 1: cand-1 (85, 72) and cand-2 (45, 38) → 3 pass, 1 fail
      expect(area1!.passCount).toBe(3);
      expect(area1!.failCount).toBe(1);

      const area2 = analysis.byArea.find((b) => b.dimensionId === 'area-2');
      expect(area2).toBeDefined();
      // Area 2: cand-3 (92, 88) → 2 pass, 0 fail
      expect(area2!.passCount).toBe(2);
      expect(area2!.failCount).toBe(0);
    });

    it('should include score distribution in analysis', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));
      await service.publishResults(tenantId, exam.id);

      const analysis = await service.generateAnalysis(tenantId, exam.id);

      // Overall score distribution should have 10 buckets
      expect(analysis.overall.scoreDistribution.length).toBe(10);

      // Each bucket should have rangeLabel, count, percentage
      for (const bucket of analysis.overall.scoreDistribution) {
        expect(bucket.rangeLabel).toBeDefined();
        expect(typeof bucket.count).toBe('number');
        expect(typeof bucket.percentage).toBe('number');
        expect(bucket.minScore).toBeLessThanOrEqual(bucket.maxScore);
      }

      // Total count across all buckets should equal total results
      const totalCount = analysis.overall.scoreDistribution.reduce((sum, b) => sum + b.count, 0);
      expect(totalCount).toBe(6);
    });

    it('should throw NotFoundError if examination does not exist', async () => {
      await expect(service.generateAnalysis(tenantId, uuid())).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError if results have not been published', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);

      await expect(service.generateAnalysis(tenantId, exam.id)).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('getAnalysis', () => {
    it('should return previously generated analysis', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));
      await service.publishResults(tenantId, exam.id);
      await service.generateAnalysis(tenantId, exam.id);

      const analysis = await service.getAnalysis(tenantId, exam.id);

      expect(analysis.examinationId).toBe(exam.id);
      expect(analysis.overall).toBeDefined();
      expect(analysis.bySubject).toBeDefined();
      expect(analysis.byCenter).toBeDefined();
      expect(analysis.byGender).toBeDefined();
      expect(analysis.byArea).toBeDefined();
    });

    it('should throw NotFoundError if analysis has not been generated', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);

      await expect(service.getAnalysis(tenantId, exam.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getPublicationResult', () => {
    it('should return publication result after publishing', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);
      resultRepository.seedCandidates(exam.id, createTestCandidates(exam.id));
      await service.publishResults(tenantId, exam.id);

      const result = await service.getPublicationResult(tenantId, exam.id);

      expect(result.examinationId).toBe(exam.id);
      expect(result.totalCandidates).toBe(3);
      expect(result.gradeResults).toHaveLength(6);
    });

    it('should throw NotFoundError if results have not been published', async () => {
      const exam = createTestExamination();
      await examRepository.create(exam);

      await expect(service.getPublicationResult(tenantId, exam.id)).rejects.toThrow(NotFoundError);
    });
  });
});
