/**
 * PRC-L048 — staff profile derives leave usage from leave records, uses the
 * appraisal template scale, sorts appraisals newest first, and resolves
 * template / program names.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Appraisal, StaffLeave } from '@/lib/api/staff';
import {
  formatAppraisalScore,
  parseServiceHistory,
  sortAppraisalsDesc,
  summariseLeaveUsage,
} from './profile-data';

const STAFF_ID = '00000000-0000-4000-8000-0000000000d1';
const TEMPLATE_ID = '00000000-0000-4000-8000-0000000000e1';
const PROGRAM_ID = '00000000-0000-4000-8000-0000000000f1';
const YEAR = new Date().getUTCFullYear();

function leave(overrides: Partial<StaffLeave>): StaffLeave {
  return {
    id: 'lv',
    tenantId: 't',
    staffId: STAFF_ID,
    leaveType: 'annual',
    startDate: `${YEAR}-03-02`,
    endDate: `${YEAR}-03-04`,
    reason: null,
    status: 'approved',
    decidedBy: null,
    decidedAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function appraisal(overrides: Partial<Appraisal>): Appraisal {
  return {
    id: 'ap',
    staffId: STAFF_ID,
    templateId: TEMPLATE_ID,
    appraisalDate: `${YEAR}-01-01`,
    scores: [],
    totalScore: 7.5,
    overallComment: null,
    status: 'APPROVED',
    workflowInstanceId: null,
    createdAt: `${YEAR}-01-01T00:00:00Z`,
    updatedAt: '',
    ...overrides,
  };
}

const leaves = [
  leave({ id: 'a' }),
  leave({ id: 'b', startDate: `${YEAR}-04-10`, endDate: `${YEAR}-04-10` }),
  leave({ id: 'c', status: 'pending' }),
  leave({ id: 'd', status: 'rejected' }),
  leave({
    id: 'e',
    leaveType: 'sick',
    startDate: `${YEAR - 1}-12-01`,
    endDate: `${YEAR - 1}-12-02`,
  }),
  leave({ id: 'f', staffId: 'someone-else' }),
];

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/lib/institutions/api', () => ({
  listClassesByInstitution: vi.fn(async () => []),
  listSubjects: vi.fn(async () => []),
}));
vi.mock('@/lib/api/institutions', () => ({ listInstitutions: vi.fn(async () => ({ data: [] })) }));
vi.mock('@/lib/api/staff', () => ({
  getStaff: vi.fn(async () => ({
    id: STAFF_ID,
    firstName: 'Asha',
    lastName: 'Rao',
    position: 'Teacher',
    status: 'ACTIVE',
    identityNumber: 'EMP-1',
    contactEmail: null,
    contactPhone: null,
    customData: {
      leaveBalance: [{ label: 'Annual', used: 0, total: 99 }],
      serviceHistory: [{ title: 'Joined' }, { bogus: true }],
    },
  })),
  listStaffAssignments: vi.fn(async () => []),
  listStaffAppraisals: vi.fn(async () => [
    appraisal({ id: 'old', appraisalDate: `${YEAR - 1}-06-01`, totalScore: 3 }),
    appraisal({ id: 'new', appraisalDate: `${YEAR}-02-01`, totalScore: 7.5 }),
  ]),
  listStaffCertifications: vi.fn(async () => [
    {
      id: 'c1',
      staffId: STAFF_ID,
      programId: PROGRAM_ID,
      certificationName: 'First aid',
      issuedDate: `${YEAR}-01-05`,
      expiryDate: null,
      status: 'ACTIVE',
      createdAt: '',
      updatedAt: '',
    },
  ]),
  listAppraisalTemplates: vi.fn(async () => [
    { id: TEMPLATE_ID, name: 'Annual review', scoreMin: 0, scoreMax: 10 },
  ]),
  listTrainingPrograms: vi.fn(async () => ({
    ok: true,
    items: [{ id: PROGRAM_ID, name: 'Safety basics' }],
  })),
  listStaffLeavesResult: vi.fn(async () => ({ ok: true, items: leaves })),
}));

import StaffProfilePage from './page';

describe('staff profile derivations (PRC-L048)', () => {
  it('derives approved days and pending requests from leave records', () => {
    expect(summariseLeaveUsage(leaves, STAFF_ID, YEAR)).toEqual([
      { leaveType: 'annual', approvedDays: 4, pendingRequests: 1 },
    ]);
  });

  it('uses the template scale and sorts appraisals newest first', () => {
    expect(formatAppraisalScore(7.5, 10)).toBe('7.5 / 10');
    expect(formatAppraisalScore(7.5, null)).toBe('7.5');
    const sorted = sortAppraisalsDesc([
      appraisal({ id: 'a', appraisalDate: '2024-01-01' }),
      appraisal({ id: 'b', appraisalDate: '2025-01-01' }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('drops malformed service-history entries', () => {
    expect(parseServiceHistory([{ title: 'Joined' }, { title: 5 }, 'x'])).toEqual([
      { title: 'Joined' },
    ]);
    expect(parseServiceHistory({})).toEqual([]);
  });

  it('renders ledger-derived leave and x / 10 for the latest appraisal', async () => {
    render(await StaffProfilePage({ params: Promise.resolve({ id: STAFF_ID }) }));
    const usage = screen.getByTestId('staff-leave-usage');
    expect(within(usage).getByText(/4 days approved · 1 pending/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('of 99 left');
    expect(screen.getByText('7.5 / 10')).toBeTruthy();
    expect(document.body.textContent).not.toContain('/ 5');
  });
});
