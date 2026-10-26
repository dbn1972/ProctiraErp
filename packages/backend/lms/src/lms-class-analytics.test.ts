/**
 * PRC-L330: class analytics loads submissions and questions for all of the
 * class's assignments in two batched repository reads (no per-assignment N+1)
 * and still produces the same aggregates.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import { LmsService } from './lms-service.js';

const TENANT = randomUUID();
const SCHOOL = randomUUID();
const teacher = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL] };

function student(id: string) {
  return { userId: id, roles: ['student'], institutions: [SCHOOL] };
}

describe('PRC-L330 — batched class analytics', () => {
  it('uses one batched read each for submissions and questions', async () => {
    const repo = new InMemoryLmsRepository();
    const svc = new LmsService(repo);
    const skill = await svc.createSkill(
      TENANT,
      { scope: 'school', institutionId: SCHOOL, code: 'FRAC', name: 'Fractions', subject: 'Maths' },
      teacher,
    );
    const students = [randomUUID(), randomUUID()];

    // Two quizzes for class 7 plus a homework, and one quiz for another class.
    const quizzes = [];
    for (const title of ['Quiz 1', 'Quiz 2']) {
      quizzes.push(
        await svc.createAssignment(
          TENANT,
          {
            scope: 'school',
            institutionId: SCHOOL,
            kind: 'quiz',
            title,
            subject: 'Maths',
            gradeLevel: '7',
            publish: true,
            questions: [
              {
                prompt: `${title} Q1`,
                options: ['A', 'B'],
                correctOptionIndex: 0,
                skillId: skill.id,
                payload: { tags: ['fractions'] },
              },
              { prompt: `${title} Q2`, options: ['A', 'B'], correctOptionIndex: 1 },
            ],
          },
          teacher,
        ),
      );
    }
    const homework = await svc.createAssignment(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL,
        kind: 'homework',
        title: 'Homework',
        subject: 'Maths',
        gradeLevel: '7',
        maxScore: 10,
        publish: true,
      },
      teacher,
    );
    const otherClass = await svc.createAssignment(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL,
        kind: 'quiz',
        title: 'Other class quiz',
        subject: 'Maths',
        gradeLevel: '8',
        publish: true,
        questions: [{ prompt: 'X', options: ['A', 'B'], correctOptionIndex: 0 }],
      },
      teacher,
    );

    // Student 0 answers both questions correctly in both quizzes; student 1
    // answers Q1 wrong in Quiz 1 only.
    for (const quiz of quizzes) {
      for (const [i, studentId] of students.entries()) {
        const wrongQ1 = i === 1 && quiz.id === quizzes[0]!.id;
        await svc.submit(
          TENANT,
          quiz.id,
          {
            studentId,
            institutionId: SCHOOL,
            answers: [
              { questionId: quiz.questions[0]!.id, selectedOptionIndex: wrongQ1 ? 1 : 0 },
              { questionId: quiz.questions[1]!.id, selectedOptionIndex: 1 },
            ],
          },
          student(studentId),
        );
      }
    }
    const hwSubmission = await svc.submit(
      TENANT,
      homework.id,
      { studentId: students[0]!, institutionId: SCHOOL, content: 'done' },
      student(students[0]!),
    );
    await svc.grade(TENANT, hwSubmission.id, { score: 8 }, teacher);
    await svc.submit(
      TENANT,
      otherClass.id,
      {
        studentId: students[0]!,
        institutionId: SCHOOL,
        answers: [{ questionId: otherClass.questions[0]!.id, selectedOptionIndex: 0 }],
      },
      student(students[0]!),
    );

    const perAssignmentSubmissions = vi.spyOn(repo, 'listSubmissions');
    const perAssignmentQuestions = vi.spyOn(repo, 'listQuestions');
    const batchedSubmissions = vi.spyOn(repo, 'listSubmissionsForAssignments');
    const batchedQuestions = vi.spyOn(repo, 'listQuestionsForAssignments');

    const analytics = await svc.getClassAnalytics(
      TENANT,
      { classKey: '7', institutionId: SCHOOL },
      teacher,
    );

    expect(perAssignmentSubmissions).not.toHaveBeenCalled();
    expect(perAssignmentQuestions).not.toHaveBeenCalled();
    expect(batchedSubmissions).toHaveBeenCalledTimes(1);
    expect(batchedQuestions).toHaveBeenCalledTimes(1);

    expect(analytics.assignmentCount).toBe(3);
    expect(analytics.submissionCount).toBe(5);
    expect(analytics.uniqueStudents).toBe(2);
    // Quiz scores: 2,2 (student 0), 1 then 2 (student 1); homework 8.
    expect(analytics.averageScore).toBeCloseTo((2 + 2 + 1 + 2 + 8) / 5, 5);
    const bySkill = new Map(analytics.masteryBySkill.map((m) => [m.skillId, m]));
    expect(bySkill.get(skill.id)?.attempts).toBe(4);
    expect(bySkill.get(skill.id)?.averageMastery).toBeCloseTo(3 / 4, 5);
    expect(bySkill.get('untagged')?.attempts).toBe(4);
    expect(bySkill.get('tag:fractions')?.attempts).toBe(4);
    expect(bySkill.get('tag:fractions')?.averageMastery).toBeCloseTo(3 / 4, 5);
  });
});
