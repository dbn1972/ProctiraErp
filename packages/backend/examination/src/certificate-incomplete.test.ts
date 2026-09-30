/**
 * PRC-H056 — result certificates must not certify PASSED when a registered
 * subject is missing/incomplete; missing marks rows are flagged, not dropped.
 */
import { describe, it, expect } from 'vitest';
import { buildCandidateResultData } from './certificate-result.js';
import { ResultPublicationService } from './result-publication-service.js';
import { DocumentGenerationService, NoOpDocumentTaskQueue } from './document-generation-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { SimplePdfGenerator } from './pdf-generator.js';
import type { CandidateRegistration, ExaminationEntity } from './examination-repository.js';

const TENANT = 'tenant-h056';

const subjects = [
  { id: 's1', name: 'Mathematics', maxScore: 100 },
  { id: 's2', name: 'English', maxScore: 100 },
];

function exam(status: ExaminationEntity['status']): ExaminationEntity {
  return {
    id: 'exam-1',
    tenantId: TENANT,
    name: 'Finals',
    code: 'FIN',
    description: null,
    academicPeriodId: 'p',
    startDate: '2025-06-01',
    endDate: '2025-06-15',
    status,
    subjects: subjects.map((s) => ({
      ...s,
      examinationId: 'exam-1',
      code: s.id.toUpperCase(),
      gradingSchemeId: 'scheme-1',
    })),
    centers: [],
    sessions: [],
    gradingSchemes: [
      {
        id: 'scheme-1',
        examinationId: 'exam-1',
        name: 'Standard',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'P', minScore: 40, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('buildCandidateResultData (PRC-H056)', () => {
  it('candidate with one ungraded (null score) subject -> INCOMPLETE, not PASSED', () => {
    const data = buildCandidateResultData({
      candidateId: 'c1',
      studentId: 'st1',
      studentName: 'A B',
      gradeResults: [
        {
          candidateId: 'c1',
          studentId: 'st1',
          subjectId: 's1',
          score: 80,
          grade: 'P',
          passed: true,
        },
      ],
      subjects,
      incompleteSubjectIds: ['s2'],
    });
    expect(data.overallPassed).toBe(false);
    expect(data.overallGrade).toBe('INCOMPLETE');
    expect(data.incompleteSubjects).toEqual(['English']);
    expect(data.maxPossibleScore).toBe(200);
  });

  it('subject absent from graded results is incomplete even if not flagged', () => {
    const data = buildCandidateResultData({
      candidateId: 'c1',
      studentId: 'st1',
      studentName: 'A B',
      gradeResults: [
        {
          candidateId: 'c1',
          studentId: 'st1',
          subjectId: 's1',
          score: 80,
          grade: 'P',
          passed: true,
        },
      ],
      subjects,
    });
    expect(data.overallPassed).toBe(false);
    expect(data.overallGrade).toBe('INCOMPLETE');
  });

  it('all subjects graded and passed -> PASS', () => {
    const data = buildCandidateResultData({
      candidateId: 'c1',
      studentId: 'st1',
      studentName: 'A B',
      gradeResults: subjects.map((s) => ({
        candidateId: 'c1',
        studentId: 'st1',
        subjectId: s.id,
        score: 70,
        grade: 'P',
        passed: true,
      })),
      subjects,
    });
    expect(data.overallPassed).toBe(true);
    expect(data.overallGrade).toBe('PASS');
    expect(data.incompleteSubjects).toEqual([]);
  });
});

describe('publishResults missing marks rows (PRC-H056)', () => {
  it('registered candidate with no marks row for a subject is listed as incomplete', async () => {
    const examRepo = new InMemoryExaminationRepository();
    const resultRepo = new InMemoryResultRepository();
    await examRepo.create(exam('IN_PROGRESS'));
    resultRepo.seedCandidates(
      'exam-1',
      [
        {
          id: 'c1',
          examinationId: 'exam-1',
          studentId: 'st1',
          centerId: 'ctr',
          gender: 'female',
          areaId: 'a',
          subjectResults: [{ candidateId: 'c1', subjectId: 's1', score: 80, isComplete: true }],
        },
        {
          id: 'c2',
          examinationId: 'exam-1',
          studentId: 'st2',
          centerId: 'ctr',
          gender: 'male',
          areaId: 'a',
          subjectResults: [],
        },
      ],
      TENANT,
    );
    const svc = new ResultPublicationService(examRepo, resultRepo);
    const result = await svc.publishResults(TENANT, 'exam-1');
    expect(result.gradeResults).toHaveLength(1);
    expect(result.incompleteRecords.map((r) => `${r.candidateId}:${r.subjectId}`).sort()).toEqual([
      'c1:s2',
      'c2:s1',
      'c2:s2',
    ]);
  });
});

function registration(
  id: string,
  studentId: string,
  subjectIds: string[],
  status: CandidateRegistration['status'] = 'REGISTERED',
): CandidateRegistration {
  return {
    id,
    examinationId: 'exam-1',
    studentId,
    tenantId: TENANT,
    centerId: 'ctr',
    subjectIds,
    status,
    registeredAt: new Date('2025-05-01T00:00:00Z'),
  };
}

describe('required subjects come from registrations (PRC-H056)', () => {
  it('subset-registered candidate with all registered subjects graded is complete and PASS', async () => {
    const examRepo = new InMemoryExaminationRepository();
    const resultRepo = new InMemoryResultRepository();
    await examRepo.create(exam('IN_PROGRESS'));
    await examRepo.createCandidateRegistration(registration('reg-1', 'st1', ['s1']));
    resultRepo.seedCandidates(
      'exam-1',
      [
        {
          id: 'c1',
          examinationId: 'exam-1',
          studentId: 'st1',
          centerId: 'ctr',
          gender: 'female',
          areaId: 'a',
          subjectResults: [{ candidateId: 'c1', subjectId: 's1', score: 75, isComplete: true }],
        },
      ],
      TENANT,
    );
    const result = await new ResultPublicationService(examRepo, resultRepo).publishResults(
      TENANT,
      'exam-1',
    );
    expect(result.incompleteRecords).toEqual([]);
    expect(result.totalCandidates).toBe(1);
    expect(result.gradeResults).toHaveLength(1);

    const cert = buildCandidateResultData({
      candidateId: 'c1',
      studentId: 'st1',
      studentName: 'A B',
      gradeResults: result.gradeResults,
      subjects,
      registeredSubjectIds: ['s1'],
      incompleteSubjectIds: result.incompleteRecords.map((r) => r.subjectId),
    });
    expect(cert.overallGrade).toBe('PASS');
    expect(cert.overallPassed).toBe(true);
    expect(cert.incompleteSubjects).toEqual([]);
    expect(cert.maxPossibleScore).toBe(100);
    expect(cert.totalScore).toBe(75);
  });

  it('registered candidate with no marks row is listed incomplete for each registered subject', async () => {
    const examRepo = new InMemoryExaminationRepository();
    const resultRepo = new InMemoryResultRepository();
    await examRepo.create(exam('IN_PROGRESS'));
    await examRepo.createCandidateRegistration(registration('reg-1', 'st1', ['s1']));
    await examRepo.createCandidateRegistration(registration('reg-2', 'st2', ['s1', 's2']));
    await examRepo.createCandidateRegistration(
      registration('reg-3', 'st3', ['s1', 's2'], 'CANCELLED'),
    );
    resultRepo.seedCandidates(
      'exam-1',
      [
        {
          id: 'c1',
          examinationId: 'exam-1',
          studentId: 'st1',
          centerId: 'ctr',
          gender: 'female',
          areaId: 'a',
          subjectResults: [{ candidateId: 'c1', subjectId: 's1', score: 75, isComplete: true }],
        },
      ],
      TENANT,
    );
    const result = await new ResultPublicationService(examRepo, resultRepo).publishResults(
      TENANT,
      'exam-1',
    );
    // st2 has no result-store row; cancelled st3 is not a candidate.
    expect(result.totalCandidates).toBe(2);
    expect(
      result.incompleteRecords.map((r) => `${r.candidateId}:${r.studentId}:${r.subjectId}`).sort(),
    ).toEqual(['reg-2:st2:s1', 'reg-2:st2:s2']);
    expect(
      result.incompleteRecords.every((r) => r.reason === 'No marks recorded for subject'),
    ).toBe(true);
  });

  it('certificate excludes unregistered-subject marks from totals and max score', () => {
    const cert = buildCandidateResultData({
      candidateId: 'c1',
      studentId: 'st1',
      studentName: 'A B',
      gradeResults: subjects.map((s) => ({
        candidateId: 'c1',
        studentId: 'st1',
        subjectId: s.id,
        score: 60,
        grade: 'P',
        passed: true,
      })),
      subjects,
      registeredSubjectIds: ['s2'],
    });
    expect(cert.subjects.map((s) => s.name)).toEqual(['English']);
    expect(cert.totalScore).toBe(60);
    expect(cert.maxPossibleScore).toBe(100);
    expect(cert.overallGrade).toBe('PASS');
  });
});

describe('result certificate generation (PRC-H056)', () => {
  it('refuses to certify candidates with incomplete results', async () => {
    const examRepo = new InMemoryExaminationRepository();
    const docRepo = new InMemoryDocumentRepository();
    await examRepo.create(exam('COMPLETED'));
    docRepo.seedCandidateResults('exam-1', [
      buildCandidateResultData({
        candidateId: 'c1',
        studentId: 'st1',
        studentName: 'A B',
        gradeResults: [
          {
            candidateId: 'c1',
            studentId: 'st1',
            subjectId: 's1',
            score: 80,
            grade: 'P',
            passed: true,
          },
        ],
        subjects,
        incompleteSubjectIds: ['s2'],
      }),
    ]);
    const svc = new DocumentGenerationService(
      examRepo,
      docRepo,
      new SimplePdfGenerator(),
      new NoOpDocumentTaskQueue(),
    );
    const job = await svc.requestGeneration(TENANT, 'exam-1', {
      documentType: 'result_certificate',
    });
    const processed = await svc.processJob(TENANT, job.id);
    expect(processed.status).toBe('failed');
    expect(processed.errorMessage).toMatch(/incomplete/i);
    expect(processed.outputPath ?? null).toBeNull();
  });
});
