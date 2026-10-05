/**
 * @vitest-environment jsdom
 *
 * PRC-M107 — no hard-coded class; quizzes are filtered server-side and paged.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lms = vi.hoisted(() => ({
  getClassAnalytics: vi.fn(),
  getQuizAnalytics: vi.fn(),
  listAssignments: vi.fn(),
  listAssignmentsPage: vi.fn(),
}));
vi.mock('@/lib/api/lms', () => lms);
vi.mock('../_components/lms-subnav', () => ({ LmsSubnav: () => null }));

import Page from './page';

const quiz = (i: number) => ({ id: `q${i}`, title: `Quiz ${i}`, gradeLevel: '7A', kind: 'quiz' });

describe('LMS class analytics (PRC-M107)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lms.listAssignments.mockResolvedValue([quiz(1), { ...quiz(2), gradeLevel: '8B' }]);
    lms.getClassAnalytics.mockResolvedValue({
      assignmentCount: 60,
      averageScore: 70,
      uniqueStudents: 30,
    });
    lms.getQuizAnalytics.mockImplementation(async () => ({
      mean: 1,
      median: 1,
      submissionCount: 1,
      items: [],
    }));
  });

  it('has no default class and loads nothing class-specific without one', async () => {
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Choose a class')).toBeTruthy();
    expect(lms.getClassAnalytics).not.toHaveBeenCalled();
    expect(lms.listAssignmentsPage).not.toHaveBeenCalled();
    const options = [...document.querySelectorAll('#analytics-class-options option')].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toEqual(['7A', '8B']);
  });

  it('requests quizzes for the class server-side and pages 60 quizzes', async () => {
    lms.listAssignmentsPage.mockResolvedValue({
      ok: true,
      items: Array.from({ length: 20 }, (_, i) => quiz(i + 21)),
      meta: { totalItems: 60 },
    });
    render(await Page({ searchParams: Promise.resolve({ classKey: '7A', page: '2' }) }));
    expect(lms.listAssignmentsPage).toHaveBeenCalledWith({
      kind: 'quiz',
      gradeLevel: '7A',
      page: 2,
      pageSize: 20,
    });
    expect(screen.getAllByTestId('lms-quiz-analytics')).toHaveLength(20);
    expect(screen.getByText(/Page 2 of 3/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Next' }).getAttribute('href')).toBe(
      '/lms/analytics?classKey=7A&page=3',
    );
  });

  it('shows an error when the quiz page fails to load', async () => {
    lms.listAssignmentsPage.mockResolvedValue({ ok: false, kind: 'unavailable', status: 503 });
    render(await Page({ searchParams: Promise.resolve({ classKey: '7A' }) }));
    expect(screen.getByTestId('lms-quiz-load-error')).toBeTruthy();
  });
});
