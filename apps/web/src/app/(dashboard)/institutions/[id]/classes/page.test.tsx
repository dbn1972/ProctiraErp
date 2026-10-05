/** PRC-M096: classes tab shows every grade by default and flags grade-load failure. */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const m = vi.hoisted(() => ({
  listClassesByInstitution: vi.fn(),
  listGrades: vi.fn(),
  listAcademicPeriods: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as never}</a>
  ),
}));
vi.mock('@/components/institutions/academics-create-dialogs', () => ({
  AddClassSectionDialog: () => null,
}));
vi.mock('@/components/institutions/class-section-controls', () => ({
  AssignClassSectionButton: () => null,
  ClassGradeFilter: ({ value }: { value: string }) => <span data-grade-filter={value} />,
  ClassPeriodFilter: () => null,
}));
vi.mock('@/lib/api/staff', () => ({ listStaff: vi.fn(async () => ({ data: [] })) }));
vi.mock('@/lib/institutions/api', () => ({
  listClassesByInstitution: m.listClassesByInstitution,
  listGrades: m.listGrades,
  listAcademicPeriods: m.listAcademicPeriods,
}));

import Page from './page';

const section = (id: string, gradeId: string) => ({
  id,
  name: `Section ${id}`,
  gradeId,
  academicPeriodId: 'p1',
  capacity: 30,
  classTeacherStaffId: null,
  roomName: null,
});

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ id: 'inst-1' }),
      searchParams: Promise.resolve(searchParams),
    } as never),
  );
}

describe('InstitutionClassesPage (PRC-M096)', () => {
  it('shows primary-only sections by default', async () => {
    m.listClassesByInstitution.mockResolvedValue([section('a', 'g1'), section('b', 'g5')]);
    m.listGrades.mockResolvedValue([
      { id: 'g1', code: '1', name: 'Grade 1', order: 1 },
      { id: 'g5', code: '5', name: 'Grade 5', order: 5 },
    ]);
    m.listAcademicPeriods.mockResolvedValue([{ id: 'p1', status: 'active', name: '2026' }]);
    const html = await render();
    expect(html).toContain('2 sections configured');
    expect(html).toContain('data-grade-filter="all"');
    expect(html).not.toContain('classes-empty');
  });

  it('distinguishes "filter hides sections" from "no sections"', async () => {
    m.listClassesByInstitution.mockResolvedValue([section('a', 'g1')]);
    m.listGrades.mockResolvedValue([{ id: 'g1', code: '1', name: 'Grade 1', order: 1 }]);
    m.listAcademicPeriods.mockResolvedValue([{ id: 'p1', status: 'active', name: '2026' }]);
    const html = await render({ grade: 'g9' });
    expect(html).toContain('classes-filtered-empty');
    expect(html).not.toContain('No class sections yet');
  });

  it('shows an alert when grades fail to load', async () => {
    m.listClassesByInstitution.mockResolvedValue([section('a', 'g1')]);
    m.listGrades.mockRejectedValue(new Error('down'));
    m.listAcademicPeriods.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain('classes-grades-error');
    expect(html).toContain('role="alert"');
  });
});
