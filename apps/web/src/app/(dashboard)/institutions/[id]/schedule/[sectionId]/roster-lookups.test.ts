/**
 * PRC-M097 — a 50-enrollment roster resolves missing student names with one
 * batch request, not one gateway call per enrollment.
 */
import { describe, expect, it, vi } from 'vitest';

// A-batch: pages check domain access before any read (route-guard.test.tsx
// covers that); this file tests the screen an allowed user sees.
vi.mock('@/lib/auth/domain-route-access', () => ({
  hasDashboardDomainRouteAccess: vi.fn(async () => true),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
const getSection = vi.fn();
const listPeriods = vi.fn(async () => ({ ok: true, data: [] }));
vi.mock('@/lib/api/timetable', () => ({
  getSection,
  listPeriods,
  listRooms: vi.fn(async () => ({ ok: true, data: [] })),
  listBellSchedules: vi.fn(async () => ({
    ok: true,
    data: [
      { id: 'bs1', name: 'Main' },
      { id: 'bs2', name: 'Winter' },
    ],
  })),
}));
const getStaff = vi.fn(async (id: string) => ({ id, firstName: 'T', lastName: id }));
vi.mock('@/lib/api/staff', () => ({
  getStaff,
  listStaff: vi.fn(async () => ({ data: [] })),
}));
const getStudent = vi.fn();
const listStudents = vi.fn(async (filters: { ids?: string[] }) => ({
  data: (filters.ids ?? []).map((id) => ({ id, firstName: 'S', lastName: id })),
  meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
}));
vi.mock('@/lib/api/students', () => ({ getStudent, listStudents }));
vi.mock('@/components/timetable/section-roster-controls', () => ({
  SectionBulkEnrollForm: () => null,
  SectionEnrollForm: () => null,
  SectionPublishControls: () => null,
  WithdrawStudentButton: () => null,
}));

describe('section roster lookups (PRC-M097)', () => {
  it('batches 50 missing students into one ids request', async () => {
    const enrollments = Array.from({ length: 50 }, (_, i) => ({
      id: `e${i}`,
      studentId: `stu-${i}`,
      status: 'ENROLLED',
    }));
    getSection.mockResolvedValue({
      ok: true,
      data: {
        id: 'sec-1',
        institutionId: 'inst-A',
        name: 'S',
        code: 'S',
        status: 'DRAFT',
        enrollments,
        meetings: [
          { id: 'm1', staffId: 'staff-1', dayOfWeek: 1, periodId: 'p1' },
          { id: 'm2', staffId: 'staff-1', dayOfWeek: 2, periodId: 'p1' },
        ],
      },
    });
    const { default: Page } = await import('./page');
    await Page({ params: Promise.resolve({ id: 'inst-A', sectionId: 'sec-1' }) });
    expect(getStudent).not.toHaveBeenCalled();
    const idCalls = listStudents.mock.calls.filter(([f]) => f.ids);
    expect(idCalls).toHaveLength(1);
    expect(idCalls[0]![0].ids).toHaveLength(50);
    // Duplicate staff ids are fetched once; periods once per bell schedule.
    expect(getStaff).toHaveBeenCalledTimes(1);
    expect(listPeriods).toHaveBeenCalledTimes(2);
  });

  it('never puts a batch-resolved student national ID in a label or searchText (HN-F4-R2)', async () => {
    listStudents.mockImplementation(async (filters: { ids?: string[] }) => ({
      data: (filters.ids ?? []).map((id) => ({
        id,
        firstName: 'Ravi',
        lastName: 'Iyer',
        nationalId: `NID-9${id}`,
      })),
      meta: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
    }));
    getSection.mockResolvedValue({
      ok: true,
      data: {
        id: 'sec-2',
        institutionId: 'inst-A',
        name: 'S',
        code: 'S',
        status: 'DRAFT',
        enrollments: [{ id: 'e1', studentId: 'stu-x', status: 'ENROLLED' }],
        meetings: [],
      },
    });
    const { default: Page } = await import('./page');
    const tree = await Page({ params: Promise.resolve({ id: 'inst-A', sectionId: 'sec-2' }) });
    const options = findProp(tree, 'studentOptions') as Array<Record<string, string>>;
    expect(options.map((o) => [o.id, o.label, o.searchText?.trim()])).toEqual([
      ['stu-x', 'Ravi Iyer', 'Ravi Iyer'],
    ]);
    expect(collectStrings(tree).join('\n')).not.toContain('NID-9');
  });
});

/** Depth-first search of a React element tree's props for the first value of `name`. */
function findProp(node: unknown, name: string, seen = new WeakSet<object>()): unknown {
  if (!node || typeof node !== 'object' || seen.has(node)) return undefined;
  seen.add(node);
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props && name in props) return props[name];
  for (const value of Object.values(props ?? (node as Record<string, unknown>))) {
    const found = findProp(value, name, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Every string reachable from a React element tree's props (rendered text and option data). */
function collectStrings(node: unknown, seen = new WeakSet<object>(), out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  if (!node || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  const props = (node as { props?: Record<string, unknown> }).props;
  for (const value of Object.values(props ?? (node as Record<string, unknown>))) {
    collectStrings(value, seen, out);
  }
  return out;
}
